import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";

import type { Config } from "./config";
import type { Db } from "./db/client";
import { AppError, ErrorCode } from "./lib/errors";
import { catalogRoutes } from "./modules/catalog/routes";
import { geographyRoutes } from "./modules/geography/routes";
import { authPlugin } from "./modules/identity/auth-plugin";
import { identityRoutes } from "./modules/identity/routes";
import { menuRoutes } from "./modules/menu/routes";
import { merchantRoutes } from "./modules/merchants/routes";
import { orderRoutes } from "./modules/orders/routes";
import type { TokenVerifier } from "./modules/identity/token-verifier";

export interface AppDeps {
  config: Pick<Config, "env" | "logLevel" | "corsOrigins" | "orderTokenSecret">;
  db: Db;
  tokenVerifier: TokenVerifier;
}

export const API_VERSION = "0.1.0";

/**
 * Construye la app sin abrir puertos. `server.ts` la pone a escuchar;
 * los tests la usan con `app.inject()`.
 */
export async function buildApp({ config, db, tokenVerifier }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    // Correlation ID: se respeta el x-request-id entrante o se genera uno (SPEC §16).
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.corsOrigins, credentials: false });

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Pedilo API",
        version: API_VERSION,
        description: "API única de Pedilo. Ver docs/SPEC.md y docs/adr/.",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  if (config.env !== "production") {
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  setErrorHandling(app);

  await app.register(authPlugin, { db, tokenVerifier });

  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Estado de la API y de la base",
        response: { 200: z.object({ status: z.literal("ok"), version: z.string() }) },
      },
    },
    async () => {
      await db.execute(sql`select 1`);
      return { status: "ok" as const, version: API_VERSION };
    },
  );

  await app.register(identityRoutes, { prefix: "/v1" });
  await app.register(geographyRoutes, { prefix: "/v1", db });
  await app.register(catalogRoutes, { prefix: "/v1", db });
  await app.register(merchantRoutes, { prefix: "/v1", db });
  await app.register(menuRoutes, { prefix: "/v1", db });
  await app.register(orderRoutes, { prefix: "/v1", db, orderTokenSecret: config.orderTokenSecret });

  return app;
}

function setErrorHandling(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: ErrorCode.NOT_FOUND, message: `Ruta ${request.method} ${request.url} inexistente` },
    }),
  );

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: "El request no cumple el esquema",
          details: err.validation.map((v) => ({
            path: v.instancePath,
            message: v.message,
          })),
        },
      });
    }

    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) },
      });
    }

    if (isResponseSerializationError(err)) {
      request.log.error({ err, issues: err.cause.issues }, "la respuesta no cumple su esquema");
      return reply.code(500).send({ error: { code: ErrorCode.INTERNAL, message: "Error interno" } });
    }

    // Errores propios de Fastify con status 4xx (JSON mal formado, body demasiado grande, etc.).
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: ErrorCode.BAD_REQUEST, message: err.message } });
    }

    request.log.error({ err }, "error no controlado");
    return reply.code(500).send({ error: { code: ErrorCode.INTERNAL, message: "Error interno" } });
  });
}
