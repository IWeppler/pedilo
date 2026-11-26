import { CourierStatus, DeliveryStatus, Vehicle } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { authOf, requireAdmin, requireAuth } from "../identity/auth-plugin";
import {
  acceptOffer,
  cancelDeliveryByMerchant,
  courierUpdateStatus,
  declineOffer,
  DEFAULT_OFFER_MINUTES,
  getMerchantCourierAccount,
  getMyCourier,
  listCourierBalances,
  listMerchantCourierBalances,
  recordCourierPayment,
  resetPinAttempts,
  listCouriersForAdmin,
  listMerchantDeliveries,
  listMyDeliveries,
  listOffers,
  registerCourier,
  reofferDelivery,
  reviewCourier,
  updateMyCourier,
} from "./service";

const vehicleSchema = z.enum(Object.values(Vehicle) as [Vehicle, ...Vehicle[]]);
const courierStatusSchema = z.enum(Object.values(CourierStatus) as [CourierStatus, ...CourierStatus[]]);
const deliveryStatusSchema = z.enum(Object.values(DeliveryStatus) as [DeliveryStatus, ...DeliveryStatus[]]);
const money = z.number().int().min(0).max(10_000_000);

const courierSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  phone: z.string(),
  vehicle: vehicleSchema,
  cityId: z.uuid(),
  minFeeMinor: z.number().int(),
  status: courierStatusSchema,
  statusReason: z.string().nullable(),
  available: z.boolean(),
  createdAt: z.string(),
});
const adminCourierSchema = courierSchema.extend({ userId: z.uuid(), lastSeenAt: z.string().nullable() });

const offerSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  pickupName: z.string(),
  pickupAddress: z.string(),
  dropoffArea: z.string().describe("Zona aproximada: la dirección exacta se ve recién al aceptar"),
  packageDescription: z.string(),
  courierFeeMinor: z.number().int(),
  tipMinor: z.number().int(),
  cashToCollectMinor: z.number().int().describe("Efectivo a cobrar al cliente (se le debe al comercio)"),
  expiresAt: z.string().describe("Hora del servidor"),
});

const deliverySchema = z.object({
  id: z.uuid(),
  orderId: z.uuid().nullable(),
  reference: z.string(),
  status: deliveryStatusSchema,
  version: z.number().int(),
  pickup: z.object({ name: z.string(), address: z.string(), phone: z.string().nullable() }),
  dropoff: z.object({ area: z.string(), address: z.string().nullable(), notes: z.string().nullable() }),
  recipient: z.object({ name: z.string(), phone: z.string() }).nullable(),
  packageDescription: z.string(),
  courierFeeMinor: z.number().int(),
  tipMinor: z.number().int(),
  cashToCollectMinor: z.number().int(),
  courier: z.object({ id: z.uuid(), name: z.string(), phone: z.string(), vehicle: vehicleSchema }).nullable(),
  pinRequired: z.boolean().describe("Para marcar entregado hay que ingresar el PIN del cliente"),
  pin: z.string().nullable().describe("Solo para el comercio; el repartidor nunca lo recibe"),
  pinLocked: z.boolean().describe("Demasiados intentos: el comercio tiene que desbloquearlo"),
  offerExpiresAt: z.string().nullable(),
  statusReason: z.string().nullable(),
  assignedAt: z.string().nullable(),
  pickedUpAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const accountEntrySchema = z.object({
  id: z.uuid(),
  kind: z.enum(["DELIVERY_FEE", "CASH_COLLECTED", "PAYMENT"]),
  amountMinor: z.number().int(),
  description: z.string(),
  deliveryId: z.uuid().nullable(),
  createdAt: z.string(),
});
const courierAccountSchema = z.object({
  courier: z.object({ id: z.uuid(), name: z.string(), phone: z.string(), vehicle: vehicleSchema }),
  balanceMinor: z.number().int(),
  entries: z.array(accountEntrySchema),
});

const phone = z.string().trim().regex(/^[0-9+()\s-]{8,24}$/, "Teléfono inválido");
const deliveryParams = z.object({ deliveryId: z.uuid() });
const merchantDeliveryParams = z.object({ merchantId: z.uuid(), deliveryId: z.uuid() });
const security = [{ bearerAuth: [] }];

export const deliveryRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // --- Repartidor ---

  app.post(
    "/courier/profile",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Registrarse como repartidor",
        description: "Queda en revisión hasta que un admin lo aprueba. 409 ALREADY_REGISTERED.",
        security,
        body: z.object({
          displayName: z.string().trim().min(2).max(80),
          phone,
          vehicle: vehicleSchema,
          cityId: z.uuid(),
          minFeeMinor: money.optional().describe("No ver ofertas que paguen menos (centavos)"),
        }),
        response: { 201: courierSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.code(201).send(await registerCourier(db, authOf(request).userId, request.body)),
  );

  app.get(
    "/courier/me",
    { onRequest: requireAuth, schema: { tags: ["couriers"], summary: "Mi perfil de repartidor", security, response: { 200: courierSchema, ...errorResponses } } },
    (request) => getMyCourier(db, authOf(request).userId),
  );

  app.patch(
    "/courier/me",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Disponibilidad, tarifa mínima y datos",
        description: "Ponerse disponible requiere perfil aprobado.",
        security,
        body: z
          .object({
            available: z.boolean(),
            minFeeMinor: money,
            displayName: z.string().trim().min(2).max(80),
            phone,
            vehicle: vehicleSchema,
          })
          .partial(),
        response: { 200: courierSchema, ...errorResponses },
      },
    },
    (request) => updateMyCourier(db, authOf(request).userId, request.body),
  );

  app.get(
    "/courier/offers",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Ofertas abiertas en mi ciudad",
        description: "Solo si estoy disponible. Las que pagan menos que mi mínimo o que rechacé no aparecen. Sin la dirección exacta.",
        security,
        response: { 200: z.array(offerSchema), ...errorResponses },
      },
    },
    (request) => listOffers(db, authOf(request).userId),
  );

  app.post(
    "/courier/offers/:deliveryId/accept",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Aceptar una oferta",
        description: "Atómico: si dos repartidores aceptan a la vez, gana uno. 409 OFFER_TAKEN u OFFER_EXPIRED.",
        security,
        params: deliveryParams,
        response: { 200: deliverySchema, ...errorResponses },
      },
    },
    (request) => acceptOffer(db, authOf(request).userId, request.params.deliveryId),
  );

  app.post(
    "/courier/offers/:deliveryId/decline",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Rechazar una oferta (no penaliza)",
        security,
        params: deliveryParams,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await declineOffer(db, authOf(request).userId, request.params.deliveryId);
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/courier/deliveries",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Mis repartos: en curso o terminados",
        security,
        querystring: z.object({ scope: z.enum(["active", "done"]).default("active") }),
        response: { 200: z.array(deliverySchema), ...errorResponses },
      },
    },
    (request) => listMyDeliveries(db, authOf(request).userId, request.query.scope),
  );

  app.post(
    "/courier/deliveries/:deliveryId/status",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Avanzar el estado de mi reparto",
        description:
          "Solo las acciones de `courierDeliveryActions` (@pedilo/domain). `eventId` lo genera la app por acción: " +
          "reintentar con el mismo no duplica nada (SPEC §9.3). Entregado con PIN: 409 PIN_INVALID (con `attemptsLeft`) o PIN_LOCKED.",
        security,
        params: deliveryParams,
        body: z.object({
          to: deliveryStatusSchema,
          reason: z.string().trim().max(300).nullable().optional(),
          eventId: z.string().min(8).max(100),
          pin: z.string().trim().regex(/^[0-9]{4}$/, "El PIN tiene 4 dígitos").nullable().optional().describe("Obligatorio para DELIVERED si el reparto pide PIN"),
        }),
        response: { 200: deliverySchema, ...errorResponses },
      },
    },
    (request) => courierUpdateStatus(db, authOf(request).userId, request.params.deliveryId, request.body),
  );

  // --- Comercio ---

  app.get(
    "/merchants/:merchantId/deliveries",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Repartos del comercio (últimos 100)",
        security,
        params: z.object({ merchantId: z.uuid() }),
        response: { 200: z.array(deliverySchema), ...errorResponses },
      },
    },
    (request) => listMerchantDeliveries(db, request.params.merchantId, authOf(request).userId),
  );

  app.post(
    "/merchants/:merchantId/deliveries/:deliveryId/reoffer",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Volver a ofertar (o subir la tarifa)",
        description: "Desde OFFERED, OFFER_EXPIRED o COURIER_CANCELLED. Quienes la habían rechazado la vuelven a ver.",
        security,
        params: merchantDeliveryParams,
        body: z.object({ feeMinor: money, offerMinutes: z.number().int().min(2).max(60).optional() }),
        response: { 200: deliverySchema, ...errorResponses },
      },
    },
    (request) =>
      reofferDelivery(
        db,
        request.params.merchantId,
        request.params.deliveryId,
        { feeMinor: request.body.feeMinor, offerMinutes: request.body.offerMinutes ?? DEFAULT_OFFER_MINUTES },
        authOf(request).userId,
      ),
  );

  app.post(
    "/merchants/:merchantId/deliveries/:deliveryId/cancel",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Cancelar la búsqueda o el reparto antes del retiro",
        description: "409 ALREADY_PICKED_UP si el repartidor ya lo retiró. El pedido sigue; se puede enviar por cuenta propia.",
        security,
        params: merchantDeliveryParams,
        body: z.object({ reason: z.string().trim().min(3).max(300) }),
        response: { 200: deliverySchema, ...errorResponses },
      },
    },
    (request) =>
      cancelDeliveryByMerchant(db, request.params.merchantId, request.params.deliveryId, request.body.reason, authOf(request).userId),
  );

  app.post(
    "/merchants/:merchantId/deliveries/:deliveryId/reset-pin",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Desbloquear el PIN de entrega",
        description: "Vuelve a cero los intentos (p. ej. después de confirmar por teléfono con el cliente).",
        security,
        params: merchantDeliveryParams,
        response: { 200: deliverySchema, ...errorResponses },
      },
    },
    (request) => resetPinAttempts(db, request.params.merchantId, request.params.deliveryId, authOf(request).userId),
  );

  // --- Cuenta comercio ↔ repartidor (ADR 0016) ---

  app.get(
    "/merchants/:merchantId/courier-balances",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Saldos con cada repartidor",
        description: "Positivo: el comercio le debe al repartidor. Negativo: el repartidor le debe efectivo al comercio.",
        security,
        params: z.object({ merchantId: z.uuid() }),
        response: {
          200: z.array(
            z.object({
              courier: z.object({ id: z.uuid(), name: z.string(), phone: z.string(), vehicle: vehicleSchema }),
              balanceMinor: z.number().int(),
              lastEntryAt: z.string(),
            }),
          ),
          ...errorResponses,
        },
      },
    },
    (request) => listMerchantCourierBalances(db, request.params.merchantId, authOf(request).userId),
  );

  app.get(
    "/merchants/:merchantId/courier-balances/:courierId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Movimientos con un repartidor",
        security,
        params: z.object({ merchantId: z.uuid(), courierId: z.uuid() }),
        response: { 200: courierAccountSchema, ...errorResponses },
      },
    },
    (request) => getMerchantCourierAccount(db, request.params.merchantId, request.params.courierId, authOf(request).userId),
  );

  app.post(
    "/merchants/:merchantId/courier-balances/:courierId/payments",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["deliveries"],
        summary: "Registrar un pago con el repartidor",
        description: "TO_COURIER: le pagaste. FROM_COURIER: te rindió el efectivo. No se editan: un error se corrige con otro pago.",
        security,
        params: z.object({ merchantId: z.uuid(), courierId: z.uuid() }),
        body: z.object({
          direction: z.enum(["TO_COURIER", "FROM_COURIER"]),
          amountMinor: z.number().int().min(1).max(100_000_000),
          note: z.string().trim().max(200).nullable().optional(),
        }),
        response: { 201: courierAccountSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        await recordCourierPayment(db, request.params.merchantId, request.params.courierId, request.body, {
          userId: authOf(request).userId,
          requestId: request.id,
        }),
      ),
  );

  app.get(
    "/courier/balances",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["couriers"],
        summary: "Mis saldos con cada comercio",
        description: "Positivo: el comercio te debe. Negativo: le debés el efectivo que cobraste.",
        security,
        response: {
          200: z.array(z.object({ merchant: z.object({ id: z.uuid(), name: z.string() }), balanceMinor: z.number().int(), entries: z.array(accountEntrySchema) })),
          ...errorResponses,
        },
      },
    },
    (request) => listCourierBalances(db, authOf(request).userId),
  );

  // --- Admin ---

  app.get(
    "/admin/couriers",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["couriers"],
        summary: "Repartidores (moderación)",
        security,
        querystring: z.object({ status: courierStatusSchema.optional() }),
        response: { 200: z.array(adminCourierSchema), ...errorResponses },
      },
    },
    (request) => listCouriersForAdmin(db, request.query.status),
  );

  app.post(
    "/admin/couriers/:courierId/review",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["couriers"],
        summary: "Aprobar, rechazar o suspender un repartidor",
        description: "Rechazar y suspender exigen motivo. Suspender lo saca de disponible.",
        security,
        params: z.object({ courierId: z.uuid() }),
        body: z.object({ status: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]), reason: z.string().trim().max(300).nullable().optional() }),
        response: { 200: adminCourierSchema, ...errorResponses },
      },
    },
    (request) =>
      reviewCourier(db, request.params.courierId, request.body.status, request.body.reason ?? null, {
        userId: authOf(request).userId,
        requestId: request.id,
      }),
  );
};
