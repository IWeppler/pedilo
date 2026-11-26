import { OrderStatus, PaymentStatus } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { WebhookSignatureValidator } from "mercadopago";
import { z } from "zod";

import type { Db } from "../../db/client";
import { conflict, errorResponses } from "../../lib/errors";
import { authOf, requireAuth } from "../identity/auth-plugin";
import {
  completeConnection,
  disconnect,
  getConnection,
  getOrderPayment,
  getPublicConfig,
  handleWebhook,
  payOrder,
  type PaymentsContext,
  startConnection,
} from "./service";

export interface PaymentRoutesOptions {
  db: Db;
  orderTokenSecret: string;
  /** null = Mercado Pago sin configurar: las rutas responden 409 MP_DISABLED. */
  ctx: PaymentsContext | null;
  webhookSecret: string | null;
  /** A dónde vuelve el comercio después del OAuth. */
  panelUrl: string;
}

const paymentStatusSchema = z.enum(Object.values(PaymentStatus) as [PaymentStatus, ...PaymentStatus[]]);
const orderStatusSchema = z.enum(Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]]);
const resultSchema = z.object({
  status: paymentStatusSchema,
  providerStatus: z.string().nullable().describe("Estado crudo de Mercado Pago (approved, in_process, rejected…)"),
  statusDetail: z.string().nullable(),
  orderStatus: orderStatusSchema,
});
const connectionSchema = z.object({
  connected: z.boolean(),
  status: z.enum(["CONNECTED", "NEEDS_REAUTH"]).nullable(),
  mpUserId: z.string().nullable(),
  liveMode: z.boolean().nullable(),
  connectedAt: z.string().nullable(),
});
const tokenHeaders = z.object({ "x-order-token": z.string().min(10).max(200) });
const merchantParams = z.object({ merchantId: z.uuid() });
const security = [{ bearerAuth: [] }];

export const paymentRoutes: FastifyPluginAsyncZod<PaymentRoutesOptions> = async (app, opts) => {
  const { db, orderTokenSecret: secret } = opts;
  const need = (): PaymentsContext => {
    if (!opts.ctx) throw conflict("Los pagos con tarjeta no están habilitados", { reason: "MP_DISABLED" });
    return opts.ctx;
  };

  app.get(
    "/payments/config",
    {
      schema: {
        tags: ["payments"],
        summary: "Configuración pública del checkout",
        description: "Public key para inicializar el SDK de Mercado Pago en el navegador. Sin caché.",
        response: { 200: z.object({ enabled: z.boolean(), publicKey: z.string().nullable() }) },
      },
    },
    async (_request, reply) => reply.header("cache-control", "no-store, max-age=0").send(getPublicConfig(opts.ctx)),
  );

  // --- Cliente: pagar el pedido (token de seguimiento) ---

  app.post(
    "/public/orders/:orderId/payments",
    {
      // Hasta 10 intentos por pedido (y por IP) cada 10 minutos: frena el testeo de tarjetas robadas.
      config: {
        rateLimit: { max: 10, timeWindow: "10 minutes", keyGenerator: (r) => `${r.ip}:${(r.params as { orderId?: string }).orderId}` },
      },
      schema: {
        tags: ["payments"],
        summary: "Pagar un pedido con tarjeta",
        description:
          "Recibe el token de la tarjeta del Card Payment Brick. Monto, comisión y comercio salen del pedido, nunca del navegador. " +
          "`Idempotency-Key` por intento: reintentar con la misma clave no cobra dos veces. " +
          "409 NOT_PAYABLE, PAYMENT_IN_PROGRESS, PAYMENT_FAILED, MP_NOT_CONNECTED o MP_DISABLED.",
        headers: tokenHeaders.extend({ "idempotency-key": z.string().min(8).max(100) }),
        params: z.object({ orderId: z.uuid() }),
        body: z.object({
          token: z.string().min(8).max(200),
          paymentMethodId: z.string().min(2).max(40),
          issuerId: z.string().max(20).nullish(),
          payer: z.object({
            email: z.email(),
            identification: z.object({ type: z.string().min(2).max(10), number: z.string().min(5).max(20) }),
          }),
        }),
        response: { 200: resultSchema, ...errorResponses },
      },
    },
    (request) =>
      payOrder(db, need(), request.params.orderId, request.headers["x-order-token"], secret, request.body, request.headers["idempotency-key"]),
  );

  app.get(
    "/public/orders/:orderId/payment",
    {
      schema: {
        tags: ["payments"],
        summary: "Estado del pago del pedido",
        description: "Si el último intento sigue en curso, se consulta a Mercado Pago. null si todavía no se intentó pagar.",
        headers: tokenHeaders,
        params: z.object({ orderId: z.uuid() }),
        response: { 200: z.object({ payment: resultSchema.nullable() }), ...errorResponses },
      },
    },
    async (request) => ({
      payment: await getOrderPayment(db, need(), request.params.orderId, request.headers["x-order-token"], secret),
    }),
  );

  // --- Webhook de Mercado Pago (firmado) ---

  app.post(
    "/webhooks/mercadopago",
    {
      schema: { hide: true, querystring: z.record(z.string(), z.string()), body: z.unknown() },
    },
    async (request, reply) => {
      const ctx = opts.ctx;
      if (!ctx || !opts.webhookSecret) return reply.code(503).send();
      const body = (request.body ?? {}) as { type?: string; data?: { id?: string | number }; user_id?: string | number };
      // La firma usa el data.id de la URL (en minúsculas si es alfanumérico).
      const dataId = String(request.query["data.id"] ?? body.data?.id ?? "").toLowerCase();
      const requestId = String(request.headers["x-request-id"] ?? "");
      try {
        WebhookSignatureValidator.validate({
          xSignature: String(request.headers["x-signature"] ?? ""),
          xRequestId: requestId,
          dataId,
          secret: opts.webhookSecret,
          toleranceSeconds: 300,
        });
      } catch {
        request.log.warn({ requestId }, "webhook de Mercado Pago con firma inválida");
        return reply.code(401).send();
      }
      const topic = String(request.query.type ?? body.type ?? "");
      await handleWebhook(db, ctx, {
        requestId,
        topic,
        dataId,
        mpUserId: body.user_id !== undefined ? String(body.user_id) : null,
      }).catch((err: unknown) => request.log.error({ err, requestId }, "falló el procesamiento del webhook"));
      // Siempre 200 una vez validado: el estado se vuelve a consultar (y los reintentos se deduplican).
      return reply.code(200).send();
    },
  );

  // --- Comercio: conectar la cuenta (OAuth) ---

  app.get(
    "/merchants/:merchantId/mercadopago",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["payments"],
        summary: "Estado de la conexión con Mercado Pago",
        security,
        params: merchantParams,
        response: { 200: connectionSchema.extend({ available: z.boolean() }), ...errorResponses },
      },
    },
    async (request) => ({
      ...(await getConnection(db, request.params.merchantId, authOf(request).userId)),
      available: opts.ctx !== null,
    }),
  );

  app.post(
    "/merchants/:merchantId/mercadopago/connect",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["payments"],
        summary: "Empezar a conectar Mercado Pago",
        description: "Solo el dueño. Devuelve la URL de autorización de Mercado Pago (vence en 10 minutos).",
        security,
        params: merchantParams,
        response: { 200: z.object({ url: z.string() }), ...errorResponses },
      },
    },
    (request) => startConnection(db, need(), request.params.merchantId, authOf(request).userId),
  );

  app.delete(
    "/merchants/:merchantId/mercadopago",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["payments"],
        summary: "Desconectar Mercado Pago",
        description: "Solo el dueño. Deja de ofrecer tarjeta; los pagos ya hechos no cambian.",
        security,
        params: merchantParams,
        response: { 200: connectionSchema, ...errorResponses },
      },
    },
    (request) => disconnect(db, request.params.merchantId, { userId: authOf(request).userId, requestId: request.id }),
  );

  app.get(
    "/payments/mercadopago/oauth/callback",
    {
      schema: {
        hide: true,
        querystring: z.object({ code: z.string().max(500).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }),
      },
    },
    async (request, reply) => {
      const ctx = need();
      const result = await completeConnection(db, ctx, request.query);
      if (!result.ok) request.log.warn({ reason: result.reason }, "no se pudo conectar Mercado Pago");
      const target = result.merchantId ? `${opts.panelUrl}/m/${result.merchantId}/profile` : `${opts.panelUrl}/`;
      return reply.redirect(`${target}?mp=${result.ok ? "connected" : "error"}`);
    },
  );
};
