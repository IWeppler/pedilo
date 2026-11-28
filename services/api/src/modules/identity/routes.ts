import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses, notFound } from "../../lib/errors";
import { nameSchema } from "../../lib/schemas";
import { authOf, requireAuth } from "./auth-plugin";
import { getCustomerProfile, saveCustomerProfile } from "./service";

const meSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  platformRole: z.enum(["ADMIN"]).nullable(),
});

const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const customerProfileSchema = z.object({
  displayName: z.string(),
  phone: z.string(),
  email: z.string().nullable().describe("El de la cuenta (Google, Apple o email)"),
  address: z
    .object({ line: z.string(), notes: z.string().nullable(), location: z.object({ lat: z.number(), lng: z.number() }).nullable() })
    .nullable()
    .describe("Dirección de entrega guardada"),
});

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+()\s-]{8,24}$/, "Teléfono inválido")
  .refine((v) => v.replace(/\D/g, "").length >= 8, "Teléfono inválido");

const security = [{ bearerAuth: [] }];

export const identityRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/me",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["identity"],
        summary: "Usuario autenticado y sus roles",
        security,
        response: { 200: meSchema, 401: errorResponses[401] },
      },
    },
    async (request) => {
      const auth = authOf(request);
      return { id: auth.userId, email: auth.email, phone: auth.phone, platformRole: auth.platformRole };
    },
  );

  app.get(
    "/customer/me",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["customers"],
        summary: "Mi perfil de cliente",
        description: "404 si todavía no completó el registro (nombre y teléfono).",
        security,
        response: { 200: customerProfileSchema, ...errorResponses },
      },
    },
    async (request) => {
      const profile = await getCustomerProfile(db, authOf(request));
      if (!profile) throw notFound("Perfil de cliente");
      return profile;
    },
  );

  app.put(
    "/customer/me",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["customers"],
        summary: "Completar o editar mi perfil de cliente",
        security,
        body: z.object({
          displayName: nameSchema,
          phone: phoneSchema,
          address: z
            .object({
              line: z.string().trim().min(3).max(160),
              notes: z.string().trim().max(200).nullable().optional(),
              location: latLngSchema.nullable().optional().describe("Punto exacto en el mapa (ADR 0023)"),
            })
            .nullable()
            .optional()
            .describe("Sin este campo, la dirección guardada no cambia; null la borra"),
        }),
        response: { 200: customerProfileSchema, ...errorResponses },
      },
    },
    (request) => saveCustomerProfile(db, authOf(request), request.body),
  );
};
