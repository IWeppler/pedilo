import { MenuLimits } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { nameSchema, nonEmptyPatch } from "../../lib/schemas";
import { authOf, requireAuth } from "../identity/auth-plugin";
import {
  createProduct,
  createSection,
  getMerchantMenu,
  getPublicMerchantMenu,
  replaceProduct,
  setProductAvailability,
  updateSection,
} from "./service";

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const priceSchema = z.number().int().min(0).max(MenuLimits.MAX_PRICE_MINOR).describe("Centavos");

const sectionSchema = z.object({ id: z.uuid(), name: z.string(), sortOrder: z.number().int(), active: z.boolean() });

const variantSchema = z.object({ id: z.uuid(), name: z.string(), priceMinor: z.number().int(), available: z.boolean() });
const modifierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  priceDeltaMinor: z.number().int(),
  maxQuantity: z.number().int(),
  available: z.boolean(),
});
const modifierGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  modifiers: z.array(modifierSchema),
});

const productFields = {
  id: z.uuid(),
  sectionId: z.uuid().nullable(),
  categoryId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  priceMinor: z.number().int(),
  fromPriceMinor: z.number().int().describe("Precio desde: variante disponible más barata o precio del producto"),
  available: z.boolean().describe("false = pausado: se ve pero no se puede pedir"),
  variants: z.array(variantSchema),
  modifierGroups: z.array(modifierGroupSchema),
};
const productSchema = z.object({
  ...productFields,
  active: z.boolean().describe("false = archivado: no aparece en el menú público"),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const publicProductSchema = z.object(productFields);

const menuSchema = z.object({ sections: z.array(sectionSchema), products: z.array(productSchema) });

const publicMenuSchema = z.object({
  merchant: z.object({
    id: z.uuid(),
    slug: z.string(),
    displayName: z.string(),
    categoryId: z.uuid(),
    payment: z.object({ cash: z.boolean(), transfer: z.boolean() }).describe("Medios de pago que acepta"),
    branches: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        cityId: z.uuid(),
        addressLine: z.string(),
        addressNotes: z.string().nullable(),
        acceptsPickup: z.boolean(),
        acceptsDelivery: z.boolean(),
        timezone: z.string(),
        hours: z.array(z.object({ weekday: z.number().int(), opensAt: z.string(), closesAt: z.string() })),
        openNow: z.boolean().describe("Abierta ahora según su horario y zona horaria"),
        scheduling: z
          .object({
            enabled: z.boolean(),
            leadMinutes: z.number().int(),
            maxDays: z.number().int(),
            slotCapacity: z.number().int().nullable(),
          })
          .describe("Pedidos programados; las franjas libres salen de GET /public/merchants/{slug}/branches/{branchId}/slots"),
        zones: z.array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            description: z.string().nullable(),
            feeMinor: z.number().int(),
            minOrderMinor: z.number().int(),
          }),
        ),
      }),
    ),
  }),
  sections: z.array(
    z.object({
      id: z.uuid().nullable().describe("null = productos sin sección («Otros»)"),
      name: z.string(),
      products: z.array(publicProductSchema),
    }),
  ),
});

const itemName = z.string().trim().min(1).max(80);

const productBody = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).nullable().optional(),
  sectionId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional().describe("Categoría global de producto (opcional)"),
  priceMinor: priceSchema.describe("Precio si no tiene variantes; con variantes manda el de la variante"),
  available: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  variants: z
    .array(z.object({ id: z.uuid().optional(), name: itemName, priceMinor: priceSchema, available: z.boolean().optional() }))
    .max(MenuLimits.MAX_VARIANTS),
  modifierGroups: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: itemName,
        minSelect: z.number().int().min(0).max(50),
        maxSelect: z.number().int().min(1).max(50),
        modifiers: z
          .array(
            z.object({
              id: z.uuid().optional(),
              name: itemName,
              priceDeltaMinor: priceSchema,
              maxQuantity: z.number().int().min(1).max(MenuLimits.MAX_OPTION_QUANTITY).optional(),
              available: z.boolean().optional(),
            }),
          )
          .max(MenuLimits.MAX_MODIFIERS_PER_GROUP),
      }),
    )
    .max(MenuLimits.MAX_GROUPS),
});

const sectionBody = z.object({
  name: nameSchema,
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});

const merchantParams = z.object({ merchantId: z.uuid() });
const sectionParams = merchantParams.extend({ sectionId: z.uuid() });
const productParams = merchantParams.extend({ productId: z.uuid() });
const security = [{ bearerAuth: [] }];
const actorOf = (request: Parameters<typeof authOf>[0]) => ({ userId: authOf(request).userId, requestId: request.id });

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export const menuRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/public/merchants/:slug",
    {
      schema: {
        tags: ["menu"],
        summary: "Comercio aprobado con sus sucursales y su menú (público)",
        description: "404 si el comercio no existe o no está aprobado.",
        params: z.object({ slug: z.string().min(1).max(100) }),
        response: { 200: publicMenuSchema, 404: errorResponses[404] },
      },
    },
    (request) => getPublicMerchantMenu(db, request.params.slug),
  );

  app.get(
    "/merchants/:merchantId/menu",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["menu"],
        summary: "Menú completo del comercio (incluye pausados y archivados)",
        security,
        params: merchantParams,
        response: { 200: menuSchema, ...errorResponses },
      },
    },
    (request) => getMerchantMenu(db, request.params.merchantId, authOf(request).userId),
  );

  app.post(
    "/merchants/:merchantId/menu/sections",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["menu"],
        summary: "Crear sección del menú",
        security,
        params: merchantParams,
        body: sectionBody,
        response: { 201: sectionSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await createSection(db, request.params.merchantId, request.body, actorOf(request))),
  );

  app.patch(
    "/merchants/:merchantId/menu/sections/:sectionId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["menu"],
        summary: "Renombrar, reordenar u ocultar una sección",
        security,
        params: sectionParams,
        body: nonEmptyPatch(sectionBody.partial()),
        response: { 200: sectionSchema, ...errorResponses },
      },
    },
    (request) =>
      updateSection(db, request.params.merchantId, request.params.sectionId, request.body, actorOf(request)),
  );

  app.post(
    "/merchants/:merchantId/menu/products",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["menu"],
        summary: "Crear producto con variantes y modificadores",
        description: "Si las reglas no se cumplen responde 400 con `details.problems` (ver @pedilo/domain validateMenuProduct).",
        security,
        params: merchantParams,
        body: productBody,
        response: { 201: productSchema, ...errorResponses },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await createProduct(db, request.params.merchantId, request.body, actorOf(request))),
  );

  app.put(
    "/merchants/:merchantId/menu/products/:productId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["menu"],
        summary: "Reemplazar un producto completo",
        description:
          "Variantes, grupos y opciones con `id` se actualizan; sin `id` se crean; los que no se envían se borran.",
        security,
        params: productParams,
        body: productBody,
        response: { 200: productSchema, ...errorResponses },
      },
    },
    (request) =>
      replaceProduct(db, request.params.merchantId, request.params.productId, request.body, actorOf(request)),
  );

  app.patch(
    "/merchants/:merchantId/menu/products/:productId/availability",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["menu"],
        summary: "Pausar o reanudar un producto",
        security,
        params: productParams,
        body: z.object({ available: z.boolean() }),
        response: { 200: productSchema, ...errorResponses },
      },
    },
    (request) =>
      setProductAvailability(
        db,
        request.params.merchantId,
        request.params.productId,
        request.body.available,
        actorOf(request),
      ),
  );
};
