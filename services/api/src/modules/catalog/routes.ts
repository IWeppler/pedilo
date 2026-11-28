import { MerchantCategory } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { idParamsSchema, nameSchema, nonEmptyPatch, slugSchema } from "../../lib/schemas";
import { authOf, requireAdmin } from "../identity/auth-plugin";
import { CategoryKind } from "./schema";
import { createCategory, getCategory, listAllCategories, listPublicCategories, updateCategory } from "./service";

const kindSchema = z.enum([CategoryKind.MERCHANT, CategoryKind.PRODUCT]);
const commissionCategorySchema = z.enum(Object.values(MerchantCategory) as [MerchantCategory, ...MerchantCategory[]]);

const categorySchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  kind: kindSchema,
  name: z.string(),
  slug: z.string(),
  commissionCategory: commissionCategorySchema.nullable(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  featuredOrder: z
    .number()
    .int()
    .nullable()
    .describe("Posición como tipo de comida en el inicio de la app; null = no aparece (solo categorías de producto)"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const listQuery = z.object({ kind: kindSchema.optional() });
const publicListQuery = listQuery.extend({
  featured: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional()
    .describe("true: solo los tipos de comida del inicio de la app, en su posición; false: los que no aparecen ahí"),
});

const createCategoryBody = z.object({
  kind: kindSchema,
  name: nameSchema,
  slug: slugSchema.optional().describe("Si se omite, se genera desde el nombre"),
  parentId: z.uuid().nullable().optional(),
  commissionCategory: commissionCategorySchema
    .nullable()
    .optional()
    .describe("Solo para rubros (MERCHANT): define el tope de comisión (SPEC §6.2)"),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
  featuredOrder: z
    .number()
    .int()
    .min(0)
    .max(1000)
    .nullable()
    .optional()
    .describe("Solo categorías de producto: posición como tipo de comida en el inicio de la app; null = no aparece"),
});

const updateCategoryBody = nonEmptyPatch(createCategoryBody.omit({ kind: true }).partial());

export const catalogRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/categories",
    {
      schema: {
        tags: ["catalog"],
        summary: "Categorías visibles (activas y con ancestros activos)",
        description: "Lista plana ordenada; el árbol se arma con `parentId`.",
        querystring: publicListQuery,
        response: { 200: z.array(categorySchema) },
      },
    },
    (request) => listPublicCategories(db, request.query.kind, request.query.featured),
  );

  app.get(
    "/admin/categories",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Todas las categorías, incluidas las inactivas",
        security: [{ bearerAuth: [] }],
        querystring: listQuery,
        response: { 200: z.array(categorySchema), 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    (request) => listAllCategories(db, request.query.kind),
  );

  app.post(
    "/admin/categories",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Crear categoría",
        security: [{ bearerAuth: [] }],
        body: createCategoryBody,
        response: { 201: categorySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const category = await createCategory(db, request.body, {
        userId: authOf(request).userId,
        requestId: request.id,
      });
      return reply.code(201).send(category);
    },
  );

  app.get(
    "/admin/categories/:id",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Detalle de una categoría",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: categorySchema, ...errorResponses },
      },
    },
    (request) => getCategory(db, request.params.id),
  );

  app.patch(
    "/admin/categories/:id",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Editar, mover o desactivar una categoría",
        description: "El tipo (`kind`) no se puede cambiar. Las categorías no se borran: se desactivan.",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateCategoryBody,
        response: { 200: categorySchema, ...errorResponses },
      },
    },
    (request) =>
      updateCategory(db, request.params.id, request.body, { userId: authOf(request).userId, requestId: request.id }),
  );
};
