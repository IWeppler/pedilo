import { canRateUntil, OrderStatus } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { OrderLimits } from "../../config";
import type { Db } from "../../db/client";
import { AppError, badRequest, ErrorCode, errorResponses } from "../../lib/errors";
import { ratingsForOrders } from "../ratings/service";
import { authOf, requireAuth } from "../identity/auth-plugin";
import { getCustomerProfile } from "../identity/service";
import {
  acknowledgeMerchantOrders,
  cancelOrderByCustomer,
  confirmMerchantPayment,
  createOrder,
  getMerchantOrdersPulse,
  getOrderForCustomer,
  listBranchSlots,
  completedAtFor,
  listCustomerOrders,
  quoteOrder,
  registerOrderPushToken,
  listMerchantOrders,
  requestOrderDelivery,
  transitionMerchantOrder,
} from "./service";

const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

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
  delivery: z
    .object({
      zoneName: z.string(),
      addressLine: z.string(),
      addressNotes: z.string().nullable(),
      location: latLngSchema.nullable().describe("Punto que marcó el cliente en el mapa (ADR 0023)"),
    })
    .nullable(),
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
  discountMinor: z.number().int().describe("Descuento de una promo del comercio (ADR 0030)"),
  promotion: z
    .object({ title: z.string(), label: z.string().describe("«20% off»"), code: z.string().nullable().describe("Código del cupón, si fue uno") })
    .nullable(),
  deliveryFeeMinor: z.number().int(),
  totalMinor: z.number().int().describe("subtotal − descuento + envío"),
  events: z.array(
    z.object({
      fromStatus: statusSchema.nullable(),
      toStatus: statusSchema,
      actorType: z.enum(["CUSTOMER", "MERCHANT", "SYSTEM"]),
      reason: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  acceptDeadlineAt: z.string().nullable().describe("Hasta cuándo el comercio puede aceptarlo; después vence solo"),
  acknowledgedAt: z.string().nullable().describe("Cuándo el comercio lo vio por primera vez"),
  scheduledFor: z.string().nullable().describe("Pedido programado: inicio de la franja de 30 min. null = lo antes posible"),
  transfer: z
    .object({ alias: z.string().nullable(), cbu: z.string().nullable(), holder: z.string() })
    .nullable()
    .describe("Datos para transferir (solo con pago por transferencia)"),
  paymentConfirmedAt: z.string().nullable().describe("Cuándo el comercio confirmó el cobro o la transferencia"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Lo que ve el comercio: el pedido más la comisión Pedilo. El cliente nunca la ve. */
const merchantOrderSchema = orderSchema.extend({
  commission: z
    .object({
      amountMinor: z.number().int(),
      basisMinor: z.number().int(),
      plan: z.string(),
      pricingVersionId: z.string(),
      capMinor: z.number().int().nullable().describe("null = sin tope"),
      capApplied: z.boolean(),
    })
    .nullable()
    .describe("Comisión Pedilo congelada al crear el pedido (ADR 0012)"),
});

const courierLocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracyM: z.number().int().nullable().describe("Precisión del GPS en metros"),
  recordedAt: z.string().describe("Cuándo se tomó el punto (hora del servidor)"),
});

const deliverySchema = z.object({
  id: z.uuid(),
  orderId: z.uuid().nullable(),
  reference: z.string(),
  status: z.string().describe("DeliveryStatus (@pedilo/domain)"),
  version: z.number().int(),
  pickup: z.object({ name: z.string(), address: z.string(), phone: z.string().nullable() }),
  dropoff: z.object({
    area: z.string(),
    address: z.string().nullable(),
    notes: z.string().nullable(),
    location: latLngSchema.nullable().describe("Punto exacto que marcó el cliente (ADR 0023); solo con el reparto asignado"),
  }),
  recipient: z.object({ name: z.string(), phone: z.string() }).nullable(),
  packageDescription: z.string(),
  courierFeeMinor: z.number().int(),
  tipMinor: z.number().int(),
  cashToCollectMinor: z.number().int(),
  courier: z.object({ id: z.uuid(), name: z.string(), phone: z.string(), vehicle: z.string() }).nullable(),
  pinRequired: z.boolean().describe("Para marcar entregado hay que ingresar el PIN del cliente"),
  pin: z.string().nullable().describe("Solo para el comercio; el repartidor nunca lo recibe"),
  pinLocked: z.boolean().describe("Demasiados intentos: el comercio tiene que desbloquearlo"),
  courierLocation: courierLocationSchema.nullable().describe("Última ubicación del repartidor con el reparto en curso (ADR 0022)"),
  offerExpiresAt: z.string().nullable(),
  statusReason: z.string().nullable(),
  assignedAt: z.string().nullable(),
  pickedUpAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const merchantOrderWithDeliverySchema = merchantOrderSchema.extend({
  dispatch: deliverySchema.nullable().describe("Reparto con repartidor de Pedilo (ADR 0014), si se pidió"),
});

/** Lo que ve el cliente: el pedido y, si va con repartidor de Pedilo, su PIN y quién lo lleva. */
const customerOrderSchema = orderSchema.extend({
  tracking: z
    .object({
      status: z.string(),
      pin: z.string().nullable().describe("Dáselo al repartidor al recibir el pedido"),
      courier: z.object({ name: z.string(), vehicle: z.string() }).nullable(),
      courierLocation: courierLocationSchema
        .nullable()
        .describe("Dónde está el repartidor: solo con el pedido ya retirado y un punto de los últimos minutos (ADR 0022)"),
    })
    .nullable(),
});

/** Saca la comisión de lo que se le devuelve al cliente. */
const forCustomer = <T extends { commission: unknown }>({ commission: _commission, ...order }: T) => order;

const createOrderBody = z.object({
  merchantSlug: z.string().min(1).max(100),
  branchId: z.uuid(),
  fulfillmentType: z.enum(["PICKUP", "DELIVERY"]),
  deliveryZoneId: z.uuid().optional(),
  deliveryAddress: z
    .object({
      line: z.string().trim().min(3).max(160),
      notes: z.string().trim().max(200).nullable().optional(),
      location: latLngSchema
        .nullable()
        .optional()
        .describe("Punto exacto marcado en el mapa (opcional, ADR 0023). 400 si queda a más de 30 km de la sucursal"),
    })
    .optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  couponCode: z
    .string()
    .trim()
    .max(20)
    .nullable()
    .optional()
    .describe("Cupón del comercio. Sin cupón se aplica sola la mejor oferta vigente (ADR 0030). 409 con reason COUPON_* si no sirve"),
  paymentMethod: z
    .enum(["CASH", "TRANSFER", "MERCADO_PAGO"])
    .optional()
    .describe("Efectivo por defecto. MERCADO_PAGO: el pedido queda esperando el pago con tarjeta (ADR 0021)"),
  scheduledFor: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Programar: inicio de una franja de GET .../slots. Sin esto, lo antes posible"),
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

export const orderRoutes: FastifyPluginAsyncZod<{
  db: Db;
  orderTokenSecret: string;
  acceptTimeoutMs?: number | undefined;
  limits?: OrderLimits | undefined;
}> = async (app, { db, orderTokenSecret, acceptTimeoutMs, limits }) => {
  // Límites anti-abuso (ADR 0010). Sin `limits` (tests) no se aplican.
  const createLimit = limits?.perIpPer10Min ? { max: limits.perIpPer10Min, timeWindow: "10 minutes" } : false;
  const trackLimit = limits ? { max: 120, timeWindow: "1 minute" } : false;

  // --- Cliente (con cuenta registrada, ADR 0026; el seguimiento sigue con token, ADR 0007) ---

  app.post(
    "/public/orders",
    {
      config: { rateLimit: createLimit },
      onRequest: requireAuth,
      schema: {
        tags: ["orders"],
        summary: "Crear un pedido (cliente registrado; efectivo, transferencia o tarjeta; inmediato o programado)",
        description:
          "Requiere sesión y perfil completo: 401 sin sesión, 403 PROFILE_REQUIRED sin nombre y teléfono (ADR 0026). " +
          "El nombre y el teléfono del pedido son los del perfil. " +
          "Reusar la Idempotency-Key de otro cliente: 409 IDEMPOTENCY_KEY_REUSED. " +
          "La API recalcula precios, disponibilidad, horario, zona y mínimo. Errores de negocio: 409 con `details.reason` " +
          "(BRANCH_CLOSED, PRODUCT_UNAVAILABLE, ITEM_INVALID, MIN_ORDER_NOT_MET, PICKUP_NOT_AVAILABLE, DELIVERY_NOT_AVAILABLE, " +
          "PAYMENT_METHOD_NOT_AVAILABLE, SCHEDULING_DISABLED, SLOT_UNAVAILABLE, SLOT_FULL). " +
          "Anti-abuso: 429 RATE_LIMITED con `details.reason` IP_RATE_LIMIT, TOO_MANY_ACTIVE_ORDERS o DAILY_LIMIT (ADR 0010).",
        security,
        headers: idempotencyHeaders,
        body: createOrderBody,
        response: { 201: z.object({ order: orderSchema, trackingToken: z.string(), replayed: z.boolean() }), ...errorResponses },
      },
    },
    async (request, reply) => {
      const auth = authOf(request);
      // Nombre y teléfono salen de la cuenta, no del request: no se pueden inventar por pedido.
      const profile = await getCustomerProfile(db, auth);
      if (!profile) {
        throw new AppError(403, ErrorCode.FORBIDDEN, "Completá tu nombre y teléfono para hacer pedidos", { reason: "PROFILE_REQUIRED" });
      }
      const input = { ...request.body, customer: { name: profile.displayName, phone: profile.phone } };
      const result = await createOrder(db, input, request.headers["idempotency-key"], {
        secret: orderTokenSecret,
        customerUserId: auth.userId,
        ...(acceptTimeoutMs !== undefined && { acceptTimeoutMs }),
        ...(limits && { limits }),
      });
      return reply.code(201).send({ ...result, order: forCustomer(result.order) });
    },
  );

  app.get(
    "/public/merchants/:slug/branches/:branchId/slots",
    {
      schema: {
        tags: ["orders"],
        summary: "Franjas para programar un pedido",
        description:
          "Franjas de 30 min dentro del horario, desde ahora + anticipación mínima hasta el máximo de días. " +
          "`available: false` = sin cupo. Lista vacía si la sucursal no acepta programados.",
        params: z.object({ slug: z.string().min(1).max(100), branchId: z.uuid() }),
        response: {
          200: z.object({
            timezone: z.string(),
            slots: z.array(z.object({ startsAt: z.string(), available: z.boolean() })),
          }),
          404: errorResponses[404],
        },
      },
    },
    (request) => listBranchSlots(db, request.params.slug, request.params.branchId),
  );

  app.get(
    "/public/orders/:orderId",
    {
      config: { rateLimit: trackLimit },
      schema: {
        tags: ["orders"],
        summary: "Seguimiento de un pedido con su token",
        description: "404 si el pedido no existe o el token no corresponde.",
        headers: tokenHeaders,
        params: orderParams,
        response: { 200: customerOrderSchema, 404: errorResponses[404] },
      },
    },
    async (request) =>
      forCustomer(await getOrderForCustomer(db, request.params.orderId, request.headers["x-order-token"], orderTokenSecret)),
  );

  app.post(
    "/public/orders/quote",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["orders"],
        summary: "Cotizar el pedido: subtotal, descuento de la promo, envío y total",
        description:
          "Mismas reglas que al pedir, sin crear nada (ADR 0030). Un cupón que no sirve vuelve en `couponError` con su `reason`; " +
          "si la oferta vigente descuenta más que el cupón, `couponOutdone`.",
        security,
        body: createOrderBody,
        response: {
          200: z.object({
            subtotalMinor: z.number().int(),
            discountMinor: z.number().int(),
            deliveryFeeMinor: z.number().int(),
            totalMinor: z.number().int(),
            promotion: z.object({ title: z.string(), label: z.string(), code: z.string().nullable() }).nullable(),
            couponOutdone: z.boolean(),
            couponError: z.object({ reason: z.string(), message: z.string() }).nullable(),
          }),
          ...errorResponses,
        },
      },
    },
    (request) => quoteOrder(db, request.body, authOf(request).userId),
  );

  app.get(
    "/customer/orders",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["customers"],
        summary: "Mis pedidos (hechos con mi cuenta)",
        description: "Los últimos 50, con el token de seguimiento para abrirlos desde cualquier celular (ADR 0026).",
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(
            z.object({
              id: z.uuid(),
              code: z.string(),
              merchantName: z.string(),
              merchantSlug: z.string(),
              itemsSummary: z.string().describe("«2× Muzzarella, Coca 1,5 L»"),
              rating: z.number().int().nullable().describe("Estrellas que le diste al comercio (ADR 0031)"),
              ratableUntil: z.string().nullable().describe("Hasta cuándo podés calificarlo; null si ya lo calificaste o no se puede"),
              status: statusSchema,
              totalMinor: z.number().int(),
              createdAt: z.string(),
              trackingToken: z.string(),
            }),
          ),
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const list = await listCustomerOrders(db, authOf(request).userId, orderTokenSecret);
      const ids = list.map((o) => o.id);
      const [completed, ratings] = await Promise.all([completedAtFor(db, ids), ratingsForOrders(db, ids)]);
      const now = new Date();
      return list.map((o) => {
        const done = completed.get(o.id);
        const until = done ? canRateUntil(done) : null;
        const rating = ratings.get(o.id) ?? null;
        return { ...o, rating, ratableUntil: rating === null && until && until > now ? until.toISOString() : null };
      });
    },
  );

  app.post(
    "/public/orders/:orderId/push-token",
    {
      schema: {
        tags: ["orders"],
        summary: "Registrar el celular para recibir avisos del pedido",
        description: "Token de Expo Push (ExponentPushToken[...]). Idempotente. Avisos de reclamos (ADR 0020).",
        headers: tokenHeaders,
        params: orderParams,
        body: z.object({ expoToken: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, "Token de Expo inválido") }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await registerOrderPushToken(db, request.params.orderId, request.headers["x-order-token"], orderTokenSecret, request.body.expoToken);
      return reply.code(204).send(null);
    },
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
    async (request) =>
      forCustomer(
        await cancelOrderByCustomer(
          db,
          request.params.orderId,
          request.headers["x-order-token"],
          orderTokenSecret,
          request.body?.reason?.trim() || null,
        ),
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
        response: { 200: z.array(merchantOrderWithDeliverySchema), ...errorResponses },
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
        response: { 200: merchantOrderSchema, ...errorResponses },
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

  app.post(
    "/merchants/:merchantId/orders/:orderId/payment/confirm",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["orders"],
        summary: "Confirmar que se cobró el efectivo o que llegó la transferencia",
        description: "Nunca automático (SPEC §8.3). Idempotente. 409 si el pago es digital o ya no se puede confirmar.",
        security,
        params: merchantParams.extend({ orderId: z.uuid() }),
        response: { 200: merchantOrderSchema, ...errorResponses },
      },
    },
    (request) =>
      confirmMerchantPayment(db, request.params.merchantId, request.params.orderId, {
        userId: authOf(request).userId,
        requestId: request.id,
      }),
  );

  app.post(
    "/merchants/:merchantId/orders/:orderId/delivery",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Pedir un repartidor de Pedilo para un pedido con envío",
        description:
          "Crea el reparto y publica la oferta a los repartidores de la ciudad. Tarifa sugerida: el costo de envío del pedido. " +
          "409 NOT_DELIVERY, INVALID_STATUS (antes de aceptar o ya salió) o DELIVERY_EXISTS.",
        security,
        params: merchantParams.extend({ orderId: z.uuid() }),
        body: z
          .object({
            feeMinor: z.number().int().min(0).max(10_000_000).optional().describe("Lo que le pagás al repartidor (centavos)"),
            offerMinutes: z.number().int().min(2).max(60).optional().describe("Minutos que dura la oferta (10)"),
            requirePin: z.boolean().optional().describe("Pedir el PIN del cliente al entregar (por defecto, sí)"),
          })
          .nullish(),
        response: { 201: merchantOrderWithDeliverySchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await requestOrderDelivery(db, request.params.merchantId, request.params.orderId, request.body ?? {}, authOf(request).userId)),
  );

  // --- Avisos al comercio (SPEC §10) ---

  app.get(
    "/merchants/:merchantId/orders/pulse",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["orders"],
        summary: "Resumen liviano para consultar cada pocos segundos",
        description:
          "`version` cambia cuando cambia cualquier pedido del comercio (entonces conviene recargar el tablero). " +
          "`waiting` lista los pedidos esperando confirmación; los que tienen `acknowledged: false` deben hacer sonar la alarma.",
        security,
        params: merchantParams,
        response: {
          200: z.object({
            version: z.string(),
            activeCount: z.number().int(),
            waiting: z.array(
              z.object({
                id: z.uuid(),
                code: z.string(),
                createdAt: z.string(),
                acceptDeadlineAt: z.string().nullable(),
                acknowledged: z.boolean(),
              }),
            ),
          }),
          ...errorResponses,
        },
      },
    },
    (request) => getMerchantOrdersPulse(db, request.params.merchantId, authOf(request).userId),
  );

  app.post(
    "/merchants/:merchantId/orders/ack",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["orders"],
        summary: "Marcar pedidos como vistos (apaga la alarma)",
        description: "Idempotente: los pedidos ya vistos o de otro comercio se ignoran.",
        security,
        params: merchantParams,
        body: z.object({ orderIds: z.array(z.uuid()).min(1).max(100) }),
        response: { 200: z.object({ acknowledged: z.number().int() }), ...errorResponses },
      },
    },
    (request) => acknowledgeMerchantOrders(db, request.params.merchantId, authOf(request).userId, request.body.orderIds),
  );
};
