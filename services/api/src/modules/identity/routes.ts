import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses, notFound } from "../../lib/errors";
import { nameSchema } from "../../lib/schemas";
import { authOf, requireAuth } from "./auth-plugin";
import { addCustomerAddress, deleteCustomerAddress, getCustomerProfile, saveCustomerProfile, updateCustomerAddress } from "./service";

const meSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  platformRole: z.enum(["ADMIN"]).nullable(),
});

const latLngSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });

const addressLabelSchema = z.enum(["HOME", "WORK", "OTHER"]).describe("Casa, Trabajo u Otra");

const customerAddressSchema = z.object({
  id: z.uuid(),
  label: addressLabelSchema,
  name: z.string().nullable().describe("Nombre de una «Otra»; null en Casa y Trabajo"),
  line: z.string(),
  notes: z.string().nullable(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});

const customerAddressInputSchema = z.object({
  label: addressLabelSchema,
  name: z.string().trim().max(40).nullable().optional().describe("Solo para una «Otra», p. ej. «Casa de mamá»"),
  line: z.string().trim().min(3).max(160),
  notes: z.string().trim().max(200).nullable().optional(),
  location: latLngSchema.nullable().optional().describe("Punto exacto en el mapa (ADR 0023)"),
});

const customerProfileSchema = z.object({
  displayName: z.string(),
  phone: z.string(),
  email: z.string().nullable().describe("El de la cuenta (Google, Apple o email)"),
  addresses: z.array(customerAddressSchema).describe("Direcciones guardadas (ADR 0034): Casa, Trabajo y otras, hasta 5"),
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
        body: z.object({ displayName: nameSchema, phone: phoneSchema }),
        response: { 200: customerProfileSchema, ...errorResponses },
      },
    },
    (request) => saveCustomerProfile(db, authOf(request), request.body),
  );

  app.post(
    "/customer/me/addresses",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["customers"],
        summary: "Guardar una dirección",
        description: "Hasta 5. 409 PROFILE_REQUIRED (sin registro), ADDRESS_LIMIT o ADDRESS_LABEL_TAKEN (ya hay Casa o Trabajo).",
        security,
        body: customerAddressInputSchema,
        response: { 201: customerAddressSchema, ...errorResponses },
      },
    },
    async (request, reply) => reply.code(201).send(await addCustomerAddress(db, authOf(request), request.body)),
  );

  app.put(
    "/customer/me/addresses/:addressId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["customers"],
        summary: "Editar una dirección",
        description: "Los pedidos hechos no cambian: guardan su copia. 409 ADDRESS_LABEL_TAKEN.",
        security,
        params: z.object({ addressId: z.uuid() }),
        body: customerAddressInputSchema,
        response: { 200: customerAddressSchema, ...errorResponses },
      },
    },
    (request) => updateCustomerAddress(db, authOf(request), request.params.addressId, request.body),
  );

  app.delete(
    "/customer/me/addresses/:addressId",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["customers"],
        summary: "Borrar una dirección",
        security,
        params: z.object({ addressId: z.uuid() }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await deleteCustomerAddress(db, authOf(request), request.params.addressId);
      return reply.code(204).send(null);
    },
  );
};
