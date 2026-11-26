import { ClaimReason, ClaimResolutionType, ClaimStatus } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { readUpload, uploadDescription } from "../../lib/uploads";
import { authOf, requireAdmin, requireAuth } from "../identity/auth-plugin";
import {
  addEvidence,
  adminMessage,
  customerMessage,
  escalateByCustomer,
  getClaimForAdmin,
  getClaimForCustomer,
  getMerchantClaim,
  listClaimsForAdmin,
  listMerchantClaims,
  markRefunded,
  merchantMessage,
  openClaim,
  proposeResolution,
  resolveByAdmin,
  respondToProposal,
} from "./service";

const reasonSchema = z.enum(Object.values(ClaimReason) as [ClaimReason, ...ClaimReason[]]);
const statusSchema = z.enum(Object.values(ClaimStatus) as [ClaimStatus, ...ClaimStatus[]]);
const resolutionSchema = z.enum(Object.values(ClaimResolutionType) as [ClaimResolutionType, ...ClaimResolutionType[]]);

const claimSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  orderCode: z.string(),
  merchant: z.object({ id: z.uuid(), name: z.string() }),
  reason: reasonSchema,
  description: z.string(),
  sensitive: z.boolean().describe("Salud o seguridad: lo gestiona Pedilo directamente"),
  status: statusSchema,
  merchantDueAt: z.string().describe("Hasta cuándo el comercio puede proponer; después se escala solo"),
  proposal: z
    .object({ type: resolutionSchema, amountMinor: z.number().int().nullable(), note: z.string().nullable(), proposedAt: z.string() })
    .nullable(),
  refundedMinor: z.number().int().nullable(),
  resolutionNote: z.string().nullable(),
  orderTotalMinor: z.number().int(),
  evidence: z.array(z.string()).describe("URLs de las fotos (relativas a la API en modo local)"),
  events: z.array(
    z.object({
      actor: z.enum(["CUSTOMER", "MERCHANT", "ADMIN", "SYSTEM"]),
      kind: z.string(),
      body: z.string().nullable(),
      amountMinor: z.number().int().nullable(),
      createdAt: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const tokenHeaders = z.object({ "x-order-token": z.string().min(10).max(200) });
const orderParams = z.object({ orderId: z.uuid() });
const merchantClaimParams = z.object({ merchantId: z.uuid(), claimId: z.uuid() });
const message = z.object({ body: z.string().trim().min(1).max(1000) });
const security = [{ bearerAuth: [] }];
const actorOf = (request: Parameters<typeof authOf>[0]) => ({ userId: authOf(request).userId, requestId: request.id });

export const claimRoutes: FastifyPluginAsyncZod<{ db: Db; orderTokenSecret: string }> = async (app, { db, orderTokenSecret: secret }) => {
  // --- Cliente (token de seguimiento del pedido) ---

  app.post(
    "/public/orders/:orderId/claim",
    {
      schema: {
        tags: ["claims"],
        summary: "Abrir un reclamo",
        description:
          "Hasta 48 h después de entregado o retirado; uno por pedido. `sensitive` (salud o seguridad) lo escala directo a Pedilo. " +
          "409 NOT_CLAIMABLE, CLAIM_WINDOW_CLOSED o CLAIM_EXISTS.",
        headers: tokenHeaders,
        params: orderParams,
        body: z.object({
          reason: reasonSchema,
          description: z.string().trim().min(10).max(1000),
          sensitive: z.boolean().optional(),
        }),
        response: { 201: claimSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await openClaim(db, request.params.orderId, request.headers["x-order-token"], secret, request.body)),
  );

  app.get(
    "/public/orders/:orderId/claim",
    {
      schema: {
        tags: ["claims"],
        summary: "Ver el reclamo del pedido",
        headers: tokenHeaders,
        params: orderParams,
        response: { 200: z.object({ claim: claimSchema.nullable() }), ...errorResponses },
      },
    },
    async (request) => ({ claim: await getClaimForCustomer(db, request.params.orderId, request.headers["x-order-token"], secret) }),
  );

  app.put(
    "/public/orders/:orderId/claim/evidence",
    {
      schema: {
        tags: ["claims"],
        summary: "Agregar una foto al reclamo (hasta 3)",
        description: uploadDescription,
        consumes: ["multipart/form-data"],
        headers: tokenHeaders,
        params: orderParams,
        response: { 200: claimSchema, ...errorResponses },
      },
    },
    async (request) =>
      addEvidence(db, request.params.orderId, request.headers["x-order-token"], secret, await readUpload(request)),
  );

  app.post(
    "/public/orders/:orderId/claim/respond",
    {
      schema: {
        tags: ["claims"],
        summary: "Aceptar o rechazar la propuesta del comercio",
        headers: tokenHeaders,
        params: orderParams,
        body: z.object({ accept: z.boolean(), comment: z.string().trim().max(500).nullable().optional() }),
        response: { 200: claimSchema, ...errorResponses },
      },
    },
    (request) => respondToProposal(db, request.params.orderId, request.headers["x-order-token"], secret, request.body),
  );

  app.post(
    "/public/orders/:orderId/claim/escalate",
    {
      schema: {
        tags: ["claims"],
        summary: "Pedir que intervenga Pedilo",
        headers: tokenHeaders,
        params: orderParams,
        body: z.object({ comment: z.string().trim().min(5).max(500) }),
        response: { 200: claimSchema, ...errorResponses },
      },
    },
    (request) => escalateByCustomer(db, request.params.orderId, request.headers["x-order-token"], secret, request.body.comment),
  );

  app.post(
    "/public/orders/:orderId/claim/messages",
    {
      schema: {
        tags: ["claims"],
        summary: "Mensaje del cliente en el reclamo",
        headers: tokenHeaders,
        params: orderParams,
        body: message,
        response: { 200: claimSchema, ...errorResponses },
      },
    },
    (request) => customerMessage(db, request.params.orderId, request.headers["x-order-token"], secret, request.body.body),
  );

  // --- Comercio ---

  app.get(
    "/merchants/:merchantId/claims",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["claims"],
        summary: "Reclamos del comercio",
        security,
        params: z.object({ merchantId: z.uuid() }),
        querystring: z.object({ scope: z.enum(["open", "all"]).default("open") }),
        response: { 200: z.array(claimSchema), ...errorResponses },
      },
    },
    (request) => listMerchantClaims(db, request.params.merchantId, authOf(request).userId, request.query.scope),
  );

  app.get(
    "/merchants/:merchantId/claims/:claimId",
    {
      onRequest: requireAuth,
      schema: { tags: ["claims"], summary: "Detalle de un reclamo", security, params: merchantClaimParams, response: { 200: claimSchema, ...errorResponses } },
    },
    (request) => getMerchantClaim(db, request.params.merchantId, request.params.claimId, authOf(request).userId),
  );

  app.post(
    "/merchants/:merchantId/claims/:claimId/propose",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["claims"],
        summary: "Proponer una solución",
        description: "REFUND_FULL (total del pedido), REFUND_PARTIAL (con monto), RESEND, REPLACE o REJECT (con nota). Se puede volver a proponer si el cliente rechazó.",
        security,
        params: merchantClaimParams,
        body: z.object({
          type: resolutionSchema,
          amountMinor: z.number().int().min(1).max(100_000_000).nullable().optional(),
          note: z.string().trim().max(500).nullable().optional(),
        }),
        response: { 200: claimSchema, ...errorResponses },
      },
    },
    (request) => proposeResolution(db, request.params.merchantId, request.params.claimId, request.body, actorOf(request)),
  );

  app.post(
    "/merchants/:merchantId/claims/:claimId/refunded",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["claims"],
        summary: "Registrar que se hizo la devolución acordada",
        description: "Efectivo o transferencia. Resuelve el reclamo y corrige la comisión de Pedilo con un asiento compensatorio.",
        security,
        params: merchantClaimParams,
        body: z.object({ note: z.string().trim().max(300).nullable().optional() }).nullish(),
        response: { 200: claimSchema, ...errorResponses },
      },
    },
    (request) => markRefunded(db, request.params.merchantId, request.params.claimId, request.body?.note ?? null, actorOf(request)),
  );

  app.post(
    "/merchants/:merchantId/claims/:claimId/messages",
    {
      onRequest: requireAuth,
      schema: { tags: ["claims"], summary: "Mensaje del comercio", security, params: merchantClaimParams, body: message, response: { 200: claimSchema, ...errorResponses } },
    },
    (request) => merchantMessage(db, request.params.merchantId, request.params.claimId, request.body.body, authOf(request).userId),
  );

  // --- Admin ---

  app.get(
    "/admin/claims",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["claims"],
        summary: "Reclamos (sensibles primero)",
        security,
        querystring: z.object({ status: statusSchema.optional() }),
        response: { 200: z.array(claimSchema), ...errorResponses },
      },
    },
    (request) => listClaimsForAdmin(db, request.query.status),
  );

  app.get(
    "/admin/claims/:claimId",
    {
      onRequest: requireAdmin,
      schema: { tags: ["claims"], summary: "Detalle de un reclamo", security, params: z.object({ claimId: z.uuid() }), response: { 200: claimSchema, ...errorResponses } },
    },
    (request) => getClaimForAdmin(db, request.params.claimId),
  );

  app.post(
    "/admin/claims/:claimId/resolve",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["claims"],
        summary: "Resolver o cerrar un reclamo",
        description: "Con nota (la ven el cliente y el comercio). No mueve dinero.",
        security,
        params: z.object({ claimId: z.uuid() }),
        body: z.object({ to: z.enum(["RESOLVED", "CLOSED"]), note: z.string().trim().min(5).max(1000) }),
        response: { 200: claimSchema, ...errorResponses },
      },
    },
    (request) => resolveByAdmin(db, request.params.claimId, request.body, actorOf(request)),
  );

  app.post(
    "/admin/claims/:claimId/messages",
    {
      onRequest: requireAdmin,
      schema: { tags: ["claims"], summary: "Mensaje de Pedilo", security, params: z.object({ claimId: z.uuid() }), body: message, response: { 200: claimSchema, ...errorResponses } },
    },
    (request) => adminMessage(db, request.params.claimId, request.body.body, authOf(request).userId),
  );
};
