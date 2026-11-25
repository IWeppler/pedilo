import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { authOf, requireAuth } from "../identity/auth-plugin";
import { enqueueTest, subscribe, unsubscribe } from "./service";

const merchantParams = z.object({ merchantId: z.uuid() });
const security = [{ bearerAuth: [] }];
const endpointSchema = z.url().max(1000).refine((u) => u.startsWith("https://"), "El endpoint debe ser https");

export const notificationRoutes: FastifyPluginAsyncZod<{ db: Db; vapidPublicKey: string | null }> = async (app, { db, vapidPublicKey }) => {
  app.get(
    "/push/public-key",
    {
      schema: {
        tags: ["notifications"],
        summary: "Clave pública VAPID para suscribirse a Web Push",
        description: "`publicKey: null` si el servidor no tiene Web Push configurado.",
        response: { 200: z.object({ publicKey: z.string().nullable() }) },
      },
    },
    () => ({ publicKey: vapidPublicKey }),
  );

  app.post(
    "/merchants/:merchantId/push-subscriptions",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["notifications"],
        summary: "Registrar este navegador para recibir avisos de pedidos",
        description: "Idempotente por endpoint: volver a registrarlo actualiza las claves.",
        security,
        params: merchantParams,
        body: z.object({ endpoint: endpointSchema, keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await subscribe(db, request.params.merchantId, authOf(request).userId, request.body, request.headers["user-agent"]?.slice(0, 300) ?? null);
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/merchants/:merchantId/push-subscriptions/remove",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["notifications"],
        summary: "Dejar de recibir avisos en este navegador",
        security,
        params: merchantParams,
        body: z.object({ endpoint: endpointSchema }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await unsubscribe(db, request.params.merchantId, authOf(request).userId, request.body.endpoint);
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/merchants/:merchantId/push-subscriptions/test",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["notifications"],
        summary: "Mandar un aviso de prueba a los dispositivos del comercio",
        security,
        params: merchantParams,
        response: { 202: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      await enqueueTest(db, request.params.merchantId, authOf(request).userId);
      return reply.code(202).send(null);
    },
  );
};
