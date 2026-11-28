import { DiscountType, PromotionKind } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { authOf, requireAuth } from "../identity/auth-plugin";
import { createPromotion, listMerchantPromotions, updatePromotion } from "./service";

const security = [{ bearerAuth: [] }];
const kindSchema = z.enum([PromotionKind.OFFER, PromotionKind.COUPON]);
const discountTypeSchema = z.enum([DiscountType.PERCENT, DiscountType.FIXED]);
const money = z.number().int().min(0).max(100_000_000);

export const promotionSchema = z.object({
  id: z.uuid(),
  kind: kindSchema.describe("OFFER: se aplica sola. COUPON: con código en el checkout"),
  code: z.string().nullable(),
  title: z.string(),
  discountType: discountTypeSchema,
  value: z.number().int().describe("Porcentaje (1–90) o monto en centavos"),
  label: z.string().describe("«20% off», «$ 2.000 off»"),
  productIds: z.array(z.uuid()).nullable().describe("null = todo el menú"),
  minSubtotalMinor: z.number().int(),
  maxDiscountMinor: z.number().int().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  maxRedemptions: z.number().int().nullable(),
  perCustomerLimit: z.number().int().nullable(),
  redemptionsCount: z.number().int().describe("Usos vigentes (sin los de pedidos cancelados)"),
  active: z.boolean(),
  live: z.boolean().describe("Vigente ahora: activa, dentro de fechas y con cupo"),
  state: z.enum(["LIVE", "SCHEDULED", "PAUSED", "EXHAUSTED", "ENDED"]).describe("En qué está ahora"),
  createdAt: z.string(),
});

export const publicOfferSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  label: z.string(),
  discountType: discountTypeSchema,
  value: z.number().int(),
  productIds: z.array(z.uuid()).nullable(),
  minSubtotalMinor: z.number().int(),
  maxDiscountMinor: z.number().int().nullable(),
  endsAt: z.string().nullable(),
});

const promotionBody = z.object({
  kind: kindSchema,
  code: z.string().trim().max(20).nullable().optional().describe("Solo cupones: 3 a 20 letras o números"),
  title: z.string().trim().min(3).max(60),
  discountType: discountTypeSchema,
  value: z.number().int().min(1).max(100_000_000),
  productIds: z.array(z.uuid()).max(200).nullable().optional().describe("null u omitido = todo el menú"),
  minSubtotalMinor: money.optional(),
  maxDiscountMinor: money.min(1).nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }).nullable().optional().describe("Omitido = desde ahora"),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).max(100).nullable().optional().describe("Cupones: 1 si se omite"),
  active: z.boolean().optional(),
});

const merchantParams = z.object({ merchantId: z.uuid() });

export const promotionRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const actorOf = (request: Parameters<typeof authOf>[0]) => ({ userId: authOf(request).userId, requestId: request.id });

  app.get(
    "/merchants/:merchantId/promotions",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["promotions"],
        summary: "Promociones del comercio (ofertas y cupones)",
        security,
        params: merchantParams,
        response: { 200: z.array(promotionSchema), ...errorResponses },
      },
    },
    (request) => listMerchantPromotions(db, request.params.merchantId, authOf(request).userId),
  );

  app.post(
    "/merchants/:merchantId/promotions",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["promotions"],
        summary: "Crear una oferta o un cupón",
        description: "Solo el dueño. Las paga el comercio (ADR 0030). 409 CODE_TAKEN si ya tiene un cupón con ese código.",
        security,
        params: merchantParams,
        body: promotionBody,
        response: { 201: promotionSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.code(201).send(await createPromotion(db, request.params.merchantId, request.body, actorOf(request))),
  );

  app.put(
    "/merchants/:merchantId/promotions/:promotionId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["promotions"],
        summary: "Editar una promoción (todo menos el tipo)",
        description: "Solo el dueño. Para pausarla, `active: false`. El cupo no puede quedar por debajo de los usos.",
        security,
        params: merchantParams.extend({ promotionId: z.uuid() }),
        body: promotionBody,
        response: { 200: promotionSchema, ...errorResponses },
      },
    },
    (request) => updatePromotion(db, request.params.merchantId, request.params.promotionId, request.body, actorOf(request)),
  );
};
