import { MAX_RATING_COMMENT } from "@pedilo/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import type { Db } from "../../db/client";
import { errorResponses } from "../../lib/errors";
import { authOf, requireAuth } from "../identity/auth-plugin";
import { listMerchantRatings, rateOrder } from "./service";

const security = [{ bearerAuth: [] }];

/** Promedio público de un comercio (solo con el mínimo de calificaciones, ADR 0031). */
export const publicRatingSchema = z
  .object({ average: z.number().describe("Un decimal, p. ej. 4.6"), count: z.number().int() })
  .nullable()
  .describe("null mientras tenga menos de 5 calificaciones");

export const ratingRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.post(
    "/customer/orders/:orderId/rating",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["ratings"],
        summary: "Calificar el comercio de un pedido",
        description:
          "Solo quien hizo el pedido, una vez, con el pedido entregado o retirado y dentro de los 14 días (ADR 0031). " +
          "409 ORDER_NOT_COMPLETED, RATING_EXISTS o RATING_WINDOW_CLOSED. El comentario lo ven el comercio y Pedilo.",
        security,
        params: z.object({ orderId: z.uuid() }),
        body: z.object({
          stars: z.number().int().min(1).max(5),
          comment: z.string().trim().max(MAX_RATING_COMMENT).nullable().optional(),
        }),
        response: {
          201: z.object({ orderId: z.uuid(), stars: z.number().int(), createdAt: z.string() }),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => reply.code(201).send(await rateOrder(db, request.params.orderId, authOf(request).userId, request.body)),
  );

  app.get(
    "/merchants/:merchantId/ratings",
    {
      onRequest: requireAuth,
      schema: {
        tags: ["ratings"],
        summary: "Calificaciones del comercio: resumen y las últimas con comentarios",
        security,
        params: z.object({ merchantId: z.uuid() }),
        response: {
          200: z.object({
            summary: z
              .object({
                average: z.number(),
                count: z.number().int(),
                distribution: z.array(z.number().int()).length(5).describe("Cuántas de 1 a 5 estrellas"),
              })
              .nullable(),
            public: z.boolean().describe("Ya se muestra en la app (5 calificaciones o más)"),
            recent: z.array(
              z.object({ id: z.uuid(), orderCode: z.string(), stars: z.number().int(), comment: z.string().nullable(), createdAt: z.string() }),
            ),
          }),
          ...errorResponses,
        },
      },
    },
    (request) => listMerchantRatings(db, request.params.merchantId, authOf(request).userId),
  );
};
