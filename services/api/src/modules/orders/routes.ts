import { OrderStatus } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { badRequest, errorResponses } from "../../lib/errors";
import { authOf, requireAuth } from "../identity/auth-plugin";
import {
  cancelOrderByCustomer,
  createOrder,
  getOrderForCustomer,
  listMerchantOrders,
  transitionMerchantOrder,
} from "./service";

const statusSchema = z.enum(Object.values(OrderStatus) as [OrderStatus, ...OrderStatus[]]);

const orderSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  merchant: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }),
  branch: z.object({ id: z.uuid(), name: z.string(), address: z.string() }),
  status: statusSchema,
  statusReason: z.string().nullable(),
  fulfillmentType: z.enum(["PICKUP", "DELIVERY"]),
  paymentMethod: z.enum(["MERCADO_PAGO", "CASH", "TRANSFER"]),
  paymentStatus: z.string(),
  customer: z.object({ name: z.string(), phone: z.string() }),
  delivery: z.object({ zoneName: z.string(), addressLine: z.string(), addressNotes: z.string().nullable() }).nullable(),
  notes: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.uuid(),
      productName: z.string(),
      variantName: z.string().nullable(),
      unitPriceMinor: z.number().int(),
      quantity: z.number().int(),
      totalMinor: z.number().int(),
      notes: z.string().nullable(),
      options: z.array(
        z.object({ groupName: z.string(), name: z.string(), quantity: z.number().int(), priceDeltaMinor: z.number().int() }),
      ),
    }),
  ),
  subtotalMinor: z.number().int(),
  deliveryFeeMinor: z.number().int(),
  totalMinor: z.number().int(),
  events: z.array(
    z.object({
      fromStatus: statusSchema.nullable(),
      toStatus: statusSchema,
      actorType: z.enum(["CUSTOMER", "MERCHANT", "SYSTEM"]),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+()\s-]{8,24}$/, "Teléfono inválido")
  .refine((v) => v.replace(/\D/g, "").length >= 8, "Teléfono inválido");

const createOrderBody = z.object({
  merchantSlug: z.string().min(1).max(100),
  branchId: z.uuid(),
  fulfillmentType: z.enum(["PICKUP", "DELIVERY"]),
  deliveryZoneId: z.uuid().optional(),
  deliveryAddress: z
    .object({ line: z.string().trim().min(3).max(160), notes: z.string().trim().max(200).nullable().optional() })
    .optional(),
  customer: z.object({ name: z.string().trim().min(2).max(80), phone: phoneSchema }),
  notes: z.string().trim().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        variantId: z.uuid().nullable().optional(),
        modifiers: z.array(z.object({ modifierId: z.uuid(), quantity: z.number().int().min(1).max(10) })).max(60),
        quantity: z.number().int().min(1).max(50),
        notes: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

const idempotencyHeaders = z.object({
  "idempotency-key": z
    .string()
    .min(8)
    .max(100)
    .describe("Clave única por intento de pedido (ADR 0005/0007). Reintentar con la misma clave devuelve el mismo pedido."),
});
const tokenHeaders = z.object({ "x-order-token": z.string().min(10).max(200).describe("Token de seguimiento del pedido") });
const orderParams = z.object({ orderId: z.uuid() });
const merchantParams = z.object({ merchantId: z.uuid() });
const security = [{ bearerAuth: [] }];

export const orderRoutes: FastifyPluginAsyncZod<{ db: Db; orderTokenSecret: string }> = async (
  app,
  { db, orderTokenSecret },
) => {
  // --- Cliente (invitado, ADR 0007) ---

  app.post(
    "/public/orders",
    {
      schema: {
        tags: ["orders"],
        summary: "Crear un pedido (invitado, pago en efectivo)",
        description:
          "La API recalcula precios, disponibilidad, horario, zona y mínimo. Errores de negocio: 409 con `details.reason` " +
          "(BRANCH_CLOSED, PRODUCT_UNAVAILABLE, ITEM_INVALID, MIN_ORDER_NOT_MET, PICKUP_NOT_AVAILABLE, DELIVERY_NOT_AVAILABLE).",
        headers: idempotencyHeaders,
        body: createOrderBody,
        response: { 201: z.object({ order: orderSchema, trackingToken: z.string(), replayed: z.boolean() }), ...errorResponses },
      },
    },
    async (request, reply) => {
      const result = await createOrder(db, request.body, request.headers["idempotency-key"], {
        secret: orderTokenSecret,
        customerUserId: request.auth?.userId ?? null,
      });
      return reply.code(201).send(result);
    },
  );

  app.get(
    "/public/orders/:orderId",
    {
      schema: {
        tags: ["orders"],
        summary: "Seguimiento de un pedido con su token",
        description: "404 si el pedido no existe o el token no corresponde.",
        headers: tokenHeaders,
        params: orderParams,
        response: { 200: orderSchema, 404: errorResponses[404] },
      },
    },
    (request) => getOrderForCustomer(db, request.params.orderId, request.headers["x-order-token"], orderTokenSecret),
  );

  app.post(
    "/public/orders/:orderId/cancel",
    {
      schema: {
        tags: ["orders"],
        summary: "Cancelar un pedido antes de que el comercio lo acepte",
        headers: tokenHeaders,
        params: orderParams,
        body: z.object({ reason: z.string().trim().max(200).nullable().optional() }).optional(),
        response: { 200: orderSchema, ...errorResponses },
      },
    },
    (request) =>
      cancelOrderByCustomer(
        db,
        request.params.orderId,
        request.headers["x-order-token"],
        orderTokenSecret,
        request.body?.reason?.trim() || null,
      ),
  );

  // --- Comercio ---

  app.get(
    "/merchants/:merchantId/orders",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["orders"],
        summary: "Pedidos del comercio: en curso (más antiguos primero) o finalizados (últimos 50)",
        security,
        params: merchantParams,
        querystring: z.object({ scope: z.enum(["active", "done"]).default("active") }),
        response: { 200: z.array(orderSchema), ...errorResponses },
      },
    },
    (request) => listMerchantOrders(db, request.params.merchantId, authOf(request).userId, request.query.scope),
  );

  app.post(
    "/merchants/:merchantId/orders/:orderId/transition",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["orders"],
        summary: "Avanzar, rechazar o cancelar un pedido",
        description: "Solo las acciones de `merchantOrderActions` (@pedilo/domain). Rechazar/cancelar exigen motivo.",
        security,
        params: merchantParams.extend({ orderId: z.uuid() }),
        body: z.object({ to: statusSchema, reason: z.string().trim().max(300).nullable().optional() }),
        response: { 200: orderSchema, ...errorResponses },
      },
    },
    (request) => {
      if (request.body.to === OrderStatus.PLACED) throw badRequest("Estado destino inválido");
      return transitionMerchantOrder(
        db,
        request.params.merchantId,
        request.params.orderId,
        request.body.to,
        request.body.reason ?? null,
        authOf(request).userId,
      );
    },
  );
};
