import { isValidCuit, MerchantStatus, OnboardingIssue } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses, notFound } from "../../lib/errors";
import { readUpload, uploadDescription } from "../../lib/uploads";
import { idParamsSchema, nameSchema, nonEmptyPatch } from "../../lib/schemas";
import { authOf, requireAdmin, requireAuth } from "../identity/auth-plugin";
import {
  approveMerchant,
  createBranch,
  createBranchClosure,
  deleteBranchClosure,
  createZone,
  getMerchantForAdmin,
  getMerchantForMember,
  listApprovedMerchantsInCity,
  listMerchantsForAdmin,
  listMyMerchants,
  registerMerchant,
  rejectMerchant,
  setMerchantSuspended,
  replaceBranchHours,
  submitMerchant,
  updateBranch,
  updateMerchantProfile,
  setMerchantImage,
  updatePaymentSettings,
  updateZone,
} from "./service";

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const statusSchema = z.enum(Object.values(MerchantStatus) as [MerchantStatus, ...MerchantStatus[]]);
const roleSchema = z.enum(["OWNER", "OPERATOR"]);

const merchantSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  legalName: z.string(),
  taxId: z.string(),
  slug: z.string(),
  categoryId: z.uuid(),
  contactPhone: z.string(),
  contactEmail: z.string().nullable(),
  logoUrl: z.string().nullable().describe("Relativa a la API (`/media/...`) en modo local"),
  coverUrl: z.string().nullable(),
  payment: z.object({
    acceptsCash: z.boolean(),
    acceptsTransfer: z.boolean(),
    transfer: z.object({ alias: z.string().nullable(), cbu: z.string().nullable(), holder: z.string().nullable() }).nullable(),
  }),
  status: statusSchema,
  rejectionReason: z.string().nullable(),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const openingRangeSchema = z.object({
  weekday: z.number().int().min(0).max(6).describe("0 = domingo … 6 = sábado"),
  opensAt: z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/, "Formato HH:MM"),
  closesAt: z
    .string()
    .regex(/^([01]\d|2[0-4]):[0-5]\d$/, "Formato HH:MM")
    .describe("Si es menor o igual que opensAt, el rango cruza la medianoche"),
});

const schedulingSchema = z.object({
  enabled: z.boolean().describe("Acepta pedidos programados"),
  leadMinutes: z.number().int().min(15).max(2880).describe("Anticipación mínima en minutos"),
  maxDays: z.number().int().min(1).max(14).describe("Hasta cuántos días adelante"),
  slotCapacity: z.number().int().min(1).max(500).nullable().describe("Pedidos por franja de 30 min; null = sin límite"),
});

const zoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  feeMinor: z.number().int().describe("Tarifa de envío en centavos"),
  minOrderMinor: z.number().int().describe("Pedido mínimo en centavos"),
  active: z.boolean(),
});

const branchSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  cityId: z.uuid(),
  addressLine: z.string(),
  addressNotes: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  phone: z.string().nullable(),
  timezone: z.string(),
  acceptsPickup: z.boolean(),
  acceptsDelivery: z.boolean(),
  active: z.boolean(),
  scheduling: schedulingSchema,
  hours: z.array(openingRangeSchema),
  zones: z.array(zoneSchema),
  closures: z
    .array(z.object({ id: z.uuid(), startsOn: z.string(), endsOn: z.string(), reason: z.string() }))
    .describe("Cierres excepcionales vigentes o futuros (fecha local de la sucursal)"),
});

const onboardingSchema = z.object({
  ready: z.boolean(),
  problems: z.array(
    z.object({
      issue: z.enum(Object.values(OnboardingIssue) as [OnboardingIssue, ...OnboardingIssue[]]),
      branchId: z.uuid().optional(),
    }),
  ),
});

const merchantDetailSchema = merchantSchema.extend({
  branches: z.array(branchSchema),
  onboarding: onboardingSchema,
});

const ownerSchema = z.object({ id: z.uuid(), email: z.string().nullable(), phone: z.string().nullable() }).nullable();

const phoneSchema = z.string().trim().min(6).max(30);
const cuitSchema = z
  .string()
  .trim()
  .refine(isValidCuit, { message: "CUIT inválido (revisá el dígito verificador)" });
const amountSchema = z.number().int().min(0).max(10_000_000);

const registerBody = z.object({
  displayName: nameSchema,
  legalName: z.string().trim().min(2).max(120),
  taxId: cuitSchema.describe("CUIT, con o sin guiones"),
  categoryId: z.uuid().describe("Rubro (categoría de tipo MERCHANT)"),
  contactPhone: phoneSchema,
  contactEmail: z.email().nullable().optional(),
});

const updateMerchantBody = nonEmptyPatch(registerBody.partial());

const branchBody = z.object({
  name: nameSchema,
  cityId: z.uuid(),
  addressLine: z.string().trim().min(3).max(160),
  addressNotes: z.string().trim().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  acceptsPickup: z.boolean().optional(),
  acceptsDelivery: z.boolean().optional(),
  active: z.boolean().optional(),
  scheduling: schedulingSchema.partial().optional(),
});

const paymentSettingsBody = z.object({
  acceptsCash: z.boolean(),
  acceptsTransfer: z.boolean(),
  transfer: z
    .object({
      alias: z.string().trim().max(40).nullable().optional(),
      cbu: z.string().trim().max(30).nullable().optional().describe("CBU o CVU (22 dígitos)"),
      holder: z.string().trim().max(120).nullable().optional().describe("Titular de la cuenta"),
    })
    .nullable()
    .optional(),
});

const zoneBody = z.object({
  name: nameSchema,
  description: z.string().trim().max(300).nullable().optional().describe("Barrios o calles que cubre"),
  feeMinor: amountSchema,
  minOrderMinor: amountSchema.optional(),
  active: z.boolean().optional(),
});

const merchantParams = z.object({ merchantId: z.uuid() });
const branchParams = merchantParams.extend({ branchId: z.uuid() });
const zoneParams = branchParams.extend({ zoneId: z.uuid() });

const security = [{ bearerAuth: [] }];
const actorOf = (request: Parameters<typeof authOf>[0]) => ({
  userId: authOf(request).userId,
  requestId: request.id,
});

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export const merchantRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // --- Comercio (dueño / miembros) ---

  app.post(
    "/merchants",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Registrar un comercio (queda en borrador; quien lo crea es el dueño)",
        security,
        body: registerBody,
        response: { 201: merchantDetailSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.code(201).send(await registerMerchant(db, request.body, actorOf(request))),
  );

  app.get(
    "/me/merchants",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Comercios de los que soy miembro",
        security,
        response: { 200: z.array(merchantSchema.extend({ role: roleSchema })), 401: errorResponses[401] },
      },
    },
    (request) => listMyMerchants(db, authOf(request).userId),
  );

  app.get(
    "/merchants/:merchantId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Detalle de un comercio propio (sucursales, horarios, zonas y checklist)",
        description: "Si no sos miembro responde 404, sin revelar si el comercio existe.",
        security,
        params: merchantParams,
        response: { 200: merchantDetailSchema.extend({ role: roleSchema }), ...errorResponses },
      },
    },
    (request) => getMerchantForMember(db, request.params.merchantId, authOf(request).userId),
  );

  app.patch(
    "/merchants/:merchantId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Editar datos del comercio",
        description:
          "En borrador o rechazado se edita todo. Aprobado: solo nombre visible y contacto. En revisión o suspendido: nada.",
        security,
        params: merchantParams,
        body: updateMerchantBody,
        response: { 200: merchantDetailSchema, ...errorResponses },
      },
    },
    (request) => updateMerchantProfile(db, request.params.merchantId, request.body, actorOf(request)),
  );

  app.put(
    "/merchants/:merchantId/payment-settings",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Medios de pago y datos de transferencia",
        description: "Solo el dueño. Se puede cambiar con el comercio aprobado. Al menos un medio; transferencia exige titular y alias o CBU/CVU.",
        security,
        params: merchantParams,
        body: paymentSettingsBody,
        response: { 200: merchantDetailSchema, ...errorResponses },
      },
    },
    (request) => updatePaymentSettings(db, request.params.merchantId, request.body, actorOf(request)),
  );

  app.put(
    "/merchants/:merchantId/images/:kind",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Subir o reemplazar el logo o la portada",
        description: `Solo el dueño. Logo: cuadrado 512 px. Portada: 1600 × 640. ${uploadDescription}`,
        consumes: ["multipart/form-data"],
        security,
        params: merchantParams.extend({ kind: z.enum(["logo", "cover"]) }),
        response: { 200: merchantDetailSchema, ...errorResponses },
      },
    },
    async (request) =>
      setMerchantImage(db, request.params.merchantId, request.params.kind, await readUpload(request), actorOf(request)),
  );

  app.delete(
    "/merchants/:merchantId/images/:kind",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Quitar el logo o la portada",
        security,
        params: merchantParams.extend({ kind: z.enum(["logo", "cover"]) }),
        response: { 200: merchantDetailSchema, ...errorResponses },
      },
    },
    (request) => setMerchantImage(db, request.params.merchantId, request.params.kind, null, actorOf(request)),
  );

  app.post(
    "/merchants/:merchantId/submit",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Enviar a revisión",
        description: "Requiere el checklist completo; si falta algo responde 409 con `details.problems`.",
        security,
        params: merchantParams,
        response: { 200: merchantDetailSchema, ...errorResponses },
      },
    },
    (request) => submitMerchant(db, request.params.merchantId, actorOf(request)),
  );

  app.post(
    "/merchants/:merchantId/branches",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Crear sucursal",
        security,
        params: merchantParams,
        body: branchBody,
        response: { 201: branchSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await createBranch(db, request.params.merchantId, request.body, actorOf(request))),
  );

  app.patch(
    "/merchants/:merchantId/branches/:branchId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Editar o desactivar una sucursal",
        security,
        params: branchParams,
        body: nonEmptyPatch(branchBody.partial()),
        response: { 200: branchSchema, ...errorResponses },
      },
    },
    (request) =>
      updateBranch(db, request.params.merchantId, request.params.branchId, request.body, actorOf(request)),
  );

  app.post(
    "/merchants/:merchantId/branches/:branchId/closures",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Agregar un cierre excepcional (feriado, vacaciones)",
        description: "Días completos, inclusive, en la fecha local de la sucursal. Hasta 60 días; no en el pasado.",
        security,
        params: branchParams,
        body: z.object({
          startsOn: z.iso.date().describe("YYYY-MM-DD"),
          endsOn: z.iso.date().describe("YYYY-MM-DD, igual o posterior"),
          reason: z.string().trim().min(2).max(80).describe("Lo ve el cliente: «Feriado», «Vacaciones»"),
        }),
        response: { 201: branchSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await createBranchClosure(db, request.params.merchantId, request.params.branchId, request.body, actorOf(request))),
  );

  app.delete(
    "/merchants/:merchantId/branches/:branchId/closures/:closureId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Quitar un cierre excepcional",
        security,
        params: branchParams.extend({ closureId: z.uuid() }),
        response: { 200: branchSchema, ...errorResponses },
      },
    },
    (request) =>
      deleteBranchClosure(db, request.params.merchantId, request.params.branchId, request.params.closureId, actorOf(request)),
  );

  app.put(
    "/merchants/:merchantId/branches/:branchId/hours",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Reemplazar el horario semanal de la sucursal",
        security,
        params: branchParams,
        body: z.object({ ranges: z.array(openingRangeSchema).max(50) }),
        response: { 200: branchSchema, ...errorResponses },
      },
    },
    (request) =>
      replaceBranchHours(
        db,
        request.params.merchantId,
        request.params.branchId,
        request.body.ranges,
        actorOf(request),
      ),
  );

  app.post(
    "/merchants/:merchantId/branches/:branchId/zones",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Crear zona de envío",
        security,
        params: branchParams,
        body: zoneBody,
        response: { 201: zoneSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await createZone(db, request.params.merchantId, request.params.branchId, request.body, actorOf(request))),
  );

  app.patch(
    "/merchants/:merchantId/branches/:branchId/zones/:zoneId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["merchants"],
        summary: "Editar o desactivar una zona de envío",
        security,
        params: zoneParams,
        body: nonEmptyPatch(zoneBody.partial()),
        response: { 200: zoneSchema, ...errorResponses },
      },
    },
    (request) =>
      updateZone(
        db,
        request.params.merchantId,
        request.params.branchId,
        request.params.zoneId,
        request.body,
        actorOf(request),
      ),
  );

  // --- Público ---

  app.get(
    "/public/cities/:citySlug/merchants",
    {
      schema: {
        tags: ["merchants"],
        summary: "Comercios aprobados con sucursal activa en la ciudad (abiertos primero)",
        description: "404 si la ciudad no existe o está inactiva.",
        params: z.object({ citySlug: z.string().min(1).max(100) }),
        querystring: z.object({ categoryId: z.uuid().optional().describe("Filtrar por rubro") }),
        response: {
          200: z.array(
            z.object({
              id: z.uuid(),
              slug: z.string(),
              displayName: z.string(),
              categoryId: z.uuid(),
              openNow: z.boolean(),
              acceptsPickup: z.boolean(),
              acceptsDelivery: z.boolean(),
              minDeliveryFeeMinor: z.number().int().nullable(),
              logoUrl: z.string().nullable(),
              coverUrl: z.string().nullable(),
            }),
          ),
          404: errorResponses[404],
        },
      },
    },
    async (request) => {
      const list = await listApprovedMerchantsInCity(db, request.params.citySlug, {
        categoryId: request.query.categoryId,
      });
      if (!list) throw notFound("Ciudad");
      return list;
    },
  );

  // --- Administración ---

  app.get(
    "/admin/merchants",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Comercios, filtrables por estado",
        description: "Con `status=PENDING_REVIEW` devuelve la cola de revisión, el más antiguo primero.",
        security,
        querystring: z.object({ status: statusSchema.optional() }),
        response: {
          200: z.array(merchantSchema.extend({ owner: ownerSchema, branchCount: z.number().int() })),
          401: errorResponses[401],
          403: errorResponses[403],
        },
      },
    },
    (request) => listMerchantsForAdmin(db, request.query.status),
  );

  app.get(
    "/admin/merchants/:id",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Detalle de un comercio para revisión",
        security,
        params: idParamsSchema,
        response: { 200: merchantDetailSchema.extend({ owner: ownerSchema }), ...errorResponses },
      },
    },
    (request) => getMerchantForAdmin(db, request.params.id),
  );

  app.post(
    "/admin/merchants/:id/approve",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Aprobar un comercio en revisión",
        security,
        params: idParamsSchema,
        response: { 200: merchantDetailSchema.extend({ owner: ownerSchema }), ...errorResponses },
      },
    },
    (request) => approveMerchant(db, request.params.id, actorOf(request)),
  );

  app.post(
    "/admin/merchants/:id/suspend",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Suspender un comercio aprobado",
        description: "Desaparece de la app y no recibe pedidos nuevos; puede terminar los que tiene en curso. El motivo lo ve el comercio.",
        security,
        params: idParamsSchema,
        body: z.object({ reason: z.string().trim().min(5).max(500) }),
        response: { 200: merchantDetailSchema.extend({ owner: ownerSchema }), ...errorResponses },
      },
    },
    (request) => setMerchantSuspended(db, request.params.id, true, request.body.reason, actorOf(request)),
  );

  app.post(
    "/admin/merchants/:id/reactivate",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Reactivar un comercio suspendido",
        security,
        params: idParamsSchema,
        response: { 200: merchantDetailSchema.extend({ owner: ownerSchema }), ...errorResponses },
      },
    },
    (request) => setMerchantSuspended(db, request.params.id, false, null, actorOf(request)),
  );

  app.post(
    "/admin/merchants/:id/reject",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Rechazar un comercio en revisión, con motivo visible para el comercio",
        security,
        params: idParamsSchema,
        body: z.object({ reason: z.string().trim().min(5).max(500) }),
        response: { 200: merchantDetailSchema.extend({ owner: ownerSchema }), ...errorResponses },
      },
    },
    (request) => rejectMerchant(db, request.params.id, request.body.reason, actorOf(request)),
  );
};
