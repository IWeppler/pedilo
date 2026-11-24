import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { errorResponses } from "../../lib/errors";
import { authOf, requireAuth } from "./auth-plugin";

const meSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  platformRole: z.enum(["ADMIN"]).nullable(),
});

export const identityRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["identity"],
        summary: "Usuario autenticado y sus roles",
        security: [{ bearerAuth: [] }],
        response: { 200: meSchema, 401: errorResponses[401] },
      },
    },
    async (request) => {
      const auth = authOf(request);
      return { id: auth.userId, email: auth.email, phone: auth.phone, platformRole: auth.platformRole };
    },
  );
};
