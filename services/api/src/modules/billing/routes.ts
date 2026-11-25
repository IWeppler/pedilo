import { MerchantCategory, PlanCode, SettlementStatus } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { authOf, requireAdmin, requireAuth } from "../identity/auth-plugin";
import {
  assignMerchantPlan,
  createAdjustment,
  createPricingVersion,
  getActivePricing,
  getMerchantBilling,
  getMerchantBillingForAdmin,
  listPricingVersions,
} from "./service";
import {
  closeSettlementWeek,
  DEFAULT_SETTLEMENT_CONFIG,
  getSettlementForAdmin,
  getSettlementForMerchant,
  listSettlementsForAdmin,
  recordSettlementPayment,
  type SettlementConfig,
} from "./settlements";

const planSchema = z.enum(Object.values(PlanCode) as [PlanCode, ...PlanCode[]]);
const categorySchema = z.enum(Object.values(MerchantCategory) as [MerchantCategory, ...MerchantCategory[]]);
const minor = z.number().int().min(0).max(1_000_000_000);
const bps = z.number().int().min(0).max(10_000);

const planTermsSchema = z.object({
  monthlyFeeMinor: minor.describe("Mensualidad en centavos"),
  baseRateBps: bps.describe("Tasa base en puntos básicos (400 = 4%)"),
  maxBranches: z.number().int().min(1).max(100),
  maxUsers: z.number().int().min(1).max(100),
});

const pricingFields = {
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9.-]{1,48}$/, "Usá minúsculas, números, puntos y guiones")
    .describe("Identificador inmutable, p. ej. v0.5"),
  brackets: z
    .array(
      z.object({
        upToMinor: minor.nullable().describe("Límite superior del tramo en centavos; null en el último"),
        rateFactorBps: bps.describe("Porción de la tasa base en este tramo (10000 = 100%)"),
      }),
    )
    .min(1)
    .max(10),
  capsByCategory: z.object(
    Object.fromEntries(Object.values(MerchantCategory).map((c) => [c, minor])) as Record<MerchantCategory, typeof minor>,
  ),
  plans: z.object(
    Object.fromEntries(Object.values(PlanCode).map((p) => [p, planTermsSchema])) as Record<PlanCode, typeof planTermsSchema>,
  ),
};

const pricingSchema = z.object({
  ...pricingFields,
  effectiveFrom: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

const settlementStatusSchema = z.enum(Object.values(SettlementStatus) as [SettlementStatus, ...SettlementStatus[]]);

const settlementSchema = z.object({
  id: z.uuid(),
  merchant: z.object({ id: z.uuid(), name: z.string() }),
  periodStart: z.string(),
  periodEnd: z.string().describe("Corte: entran los asientos anteriores a este instante"),
  totalMinor: z.number().int(),
  paidMinor: z.number().int(),
  outstandingMinor: z.number().int(),
  entryCount: z.number().int(),
  dueAt: z.string(),
  status: settlementStatusSchema,
  createdAt: z.string(),
});

const settlementDetailSchema = settlementSchema.extend({
  payments: z.array(
    z.object({
      id: z.uuid(),
      amountMinor: z.number().int(),
      method: z.enum(["TRANSFER", "CASH", "OTHER"]),
      reference: z.string().nullable(),
      paidAt: z.string(),
      createdAt: z.string(),
    }),
  ),
  entries: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      amountMinor: z.number().int(),
      description: z.string(),
      orderId: z.uuid().nullable(),
      createdAt: z.string(),
    }),
  ),
});

const billingSchema = z.object({
  plan: planTermsSchema.extend({ code: planSchema, since: z.string().nullable().describe("null = nunca asignado (Emprendedor)") }),
  category: categorySchema,
  categoryDefaulted: z.boolean().describe("El rubro no tiene categoría de comisión: se usa la de emprendedores"),
  capMinor: z.number().int(),
  pricing: pricingSchema,
  balanceMinor: z.number().int().describe("Lo que el comercio debe: asientos − pagos"),
  unsettledMinor: z.number().int().describe("Parte del saldo que todavía no entró en una liquidación"),
  settlements: z.array(settlementSchema),
  history: z.array(z.object({ code: planSchema, startsAt: z.string(), endsAt: z.string().nullable(), reason: z.string().nullable() })),
  entries: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["ACCRUED", "ADJUSTMENT"]),
      amountMinor: z.number().int(),
      description: z.string(),
      orderId: z.uuid().nullable(),
      createdAt: z.string(),
    }),
  ),
});

const merchantParams = z.object({ merchantId: z.uuid() });
const security = [{ bearerAuth: [] }];
const actorOf = (request: Parameters<typeof authOf>[0]) => ({ userId: authOf(request).userId, requestId: request.id });

const settlementParams = z.object({ settlementId: z.uuid() });

export const billingRoutes: FastifyPluginAsyncZod<{ db: Db; settlement?: SettlementConfig | undefined }> = async (
  app,
  { db, settlement = DEFAULT_SETTLEMENT_CONFIG },
) => {
  app.get(
    "/merchants/:merchantId/settlements/:settlementId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["billing"],
        summary: "Detalle de una liquidación del comercio",
        security,
        params: merchantParams.extend(settlementParams.shape),
        response: { 200: settlementDetailSchema, ...errorResponses },
      },
    },
    (request) =>
      getSettlementForMerchant(db, request.params.merchantId, request.params.settlementId, authOf(request).userId),
  );

  app.get(
    "/admin/settlements",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Liquidaciones de todos los comercios (vencidas primero)",
        security,
        querystring: z.object({ status: settlementStatusSchema.optional() }),
        response: { 200: z.array(settlementSchema), ...errorResponses },
      },
    },
    (request) => listSettlementsForAdmin(db, request.query.status),
  );

  app.get(
    "/admin/settlements/:settlementId",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Detalle de una liquidación: asientos y pagos",
        security,
        params: settlementParams,
        response: { 200: settlementDetailSchema, ...errorResponses },
      },
    },
    (request) => getSettlementForAdmin(db, request.params.settlementId),
  );

  app.post(
    "/admin/settlements/:settlementId/payments",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Registrar un pago del comercio",
        description: "Parcial o total. 409 OVERPAYMENT si supera lo pendiente, ALREADY_PAID si ya está pagada. Los pagos no se editan.",
        security,
        params: settlementParams,
        body: z.object({
          amountMinor: z.number().int().min(1).max(1_000_000_000),
          method: z.enum(["TRANSFER", "CASH", "OTHER"]),
          reference: z.string().trim().max(120).nullable().optional().describe("Número de operación o comprobante"),
          paidAt: z.iso.datetime({ offset: true }).optional().describe("Cuándo pagó (por defecto, ahora)"),
        }),
        response: { 201: settlementDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await recordSettlementPayment(db, request.params.settlementId, request.body, actorOf(request))),
  );

  app.post(
    "/admin/settlements/close",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Cerrar la última semana ahora",
        description: "Lo hace solo el worker cada lunes; esto lo corre a mano. Idempotente: no duplica liquidaciones.",
        security,
        response: { 200: z.object({ created: z.number().int() }), ...errorResponses },
      },
    },
    async (request) => ({ created: await closeSettlementWeek(db, { config: settlement, actorUserId: authOf(request).userId }) }),
  );

  app.get(
    "/pricing/current",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["billing"],
        summary: "Versión de pricing vigente (planes, tramos y topes)",
        description: "Para comparar planes y simular comisiones. Son la hipótesis comercial: precios a validar (SPEC §6.1).",
        security,
        response: { 200: pricingSchema, ...errorResponses },
      },
    },
    () => getActivePricing(db),
  );

  app.get(
    "/merchants/:merchantId/billing",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["billing"],
        summary: "Plan, comisiones y estado de cuenta del comercio",
        security,
        params: merchantParams,
        response: { 200: billingSchema, ...errorResponses },
      },
    },
    (request) => getMerchantBilling(db, request.params.merchantId, authOf(request).userId),
  );

  // --- Admin ---

  app.get(
    "/admin/pricing-versions",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Versiones de pricing, la más nueva primero",
        security,
        response: { 200: z.array(pricingSchema), ...errorResponses },
      },
    },
    () => listPricingVersions(db),
  );

  app.post(
    "/admin/pricing-versions",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Crear una versión de pricing (solo hacia adelante)",
        description: "`effectiveFrom` tiene que ser futura. Las versiones no se editan: un cambio es una versión nueva.",
        security,
        body: z.object({
          ...pricingFields,
          effectiveFrom: z.iso.datetime({ offset: true }),
          notes: z.string().trim().max(500).nullable().optional(),
        }),
        response: { 201: pricingSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.code(201).send(await createPricingVersion(db, request.body, actorOf(request))),
  );

  app.get(
    "/admin/merchants/:merchantId/billing",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Plan y estado de cuenta de un comercio",
        security,
        params: merchantParams,
        response: { 200: billingSchema, ...errorResponses },
      },
    },
    (request) => getMerchantBillingForAdmin(db, request.params.merchantId),
  );

  app.put(
    "/admin/merchants/:merchantId/plan",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Cambiar el plan de un comercio desde ahora",
        description: "Nunca retroactivo: los pedidos ya creados conservan su comisión.",
        security,
        params: merchantParams,
        body: z.object({ plan: planSchema, reason: z.string().trim().max(300).nullable().optional() }),
        response: { 200: billingSchema, ...errorResponses },
      },
    },
    async (request) => {
      await getMerchantBillingForAdmin(db, request.params.merchantId); // 404 si no existe
      await assignMerchantPlan(db, request.params.merchantId, request.body.plan, request.body.reason ?? null, actorOf(request));
      return getMerchantBillingForAdmin(db, request.params.merchantId);
    },
  );

  app.post(
    "/admin/merchants/:merchantId/commission-adjustments",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["billing"],
        summary: "Ajuste manual del saldo de comisiones",
        description: "Asiento compensatorio con motivo: positivo suma deuda, negativo es crédito. Nunca se editan asientos.",
        security,
        params: merchantParams,
        body: z.object({
          amountMinor: z.number().int().min(-100_000_000).max(100_000_000),
          description: z.string().trim().min(3).max(300),
        }),
        response: { 201: billingSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      await getMerchantBillingForAdmin(db, request.params.merchantId);
      await createAdjustment(db, request.params.merchantId, request.body, actorOf(request));
      return reply.code(201).send(await getMerchantBillingForAdmin(db, request.params.merchantId));
    },
  );
};
