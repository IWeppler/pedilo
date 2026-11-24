import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { errorResponses } from "../../lib/errors";
import { idParamsSchema, nameSchema, nonEmptyPatch, slugSchema, timezoneSchema } from "../../lib/schemas";
import type { Db } from "../../db/client";
import { authOf, requireAdmin } from "../identity/auth-plugin";
import { createCity, getCity, listActiveCities, listAllCities, updateCity } from "./service";

const citySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  province: z.string(),
  country: z.string(),
  timezone: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createCityBody = z.object({
  name: nameSchema,
  province: nameSchema,
  slug: slugSchema.optional().describe("Si se omite, se genera desde el nombre"),
  timezone: timezoneSchema.optional(),
  active: z.boolean().optional(),
});

const updateCityBody = nonEmptyPatch(createCityBody.partial());

export const geographyRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/cities",
    {
      schema: {
        tags: ["geography"],
        summary: "Ciudades activas",
        response: { 200: z.array(citySchema) },
      },
    },
    () => listActiveCities(db),
  );

  app.get(
    "/admin/cities",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Todas las ciudades, incluidas las inactivas",
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(citySchema), 401: errorResponses[401], 403: errorResponses[403] },
      },
    },
    () => listAllCities(db),
  );

  app.post(
    "/admin/cities",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Crear ciudad",
        security: [{ bearerAuth: [] }],
        body: createCityBody,
        response: { 201: citySchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const city = await createCity(db, request.body, { userId: authOf(request).userId, requestId: request.id });
      return reply.code(201).send(city);
    },
  );

  app.get(
    "/admin/cities/:id",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Detalle de una ciudad",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        response: { 200: citySchema, ...errorResponses },
      },
    },
    (request) => getCity(db, request.params.id),
  );

  app.patch(
    "/admin/cities/:id",
    {
      onRequest: requireAdmin,
      schema: {
        tags: ["admin"],
        summary: "Editar o desactivar una ciudad",
        description: "Las ciudades no se borran: se desactivan con `active: false` (ADR 0005).",
        security: [{ bearerAuth: [] }],
        params: idParamsSchema,
        body: updateCityBody,
        response: { 200: citySchema, ...errorResponses },
      },
    },
    (request) =>
      updateCity(db, request.params.id, request.body, { userId: authOf(request).userId, requestId: request.id }),
  );
};
