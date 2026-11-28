import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
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
import { AppError, ErrorCode, tooManyRequests } from "./lib/errors";
import multipart from "@fastify/multipart";

import { configureMedia, createLocalStorage, createSupabaseStorage, MAX_UPLOAD_BYTES, media } from "./lib/media";
import { billingRoutes } from "./modules/billing/routes";
import { catalogRoutes } from "./modules/catalog/routes";
import { claimRoutes } from "./modules/claims/routes";
import { deliveryRoutes } from "./modules/deliveries/routes";
import { onDeliveryStatusChange } from "./modules/deliveries/service";
import { applyDeliveryEvent } from "./modules/orders/service";
import { geographyRoutes } from "./modules/geography/routes";
import { authPlugin } from "./modules/identity/auth-plugin";
import { identityRoutes } from "./modules/identity/routes";
import { menuRoutes } from "./modules/menu/routes";
import { merchantRoutes } from "./modules/merchants/routes";
import { notificationRoutes } from "./modules/notifications/routes";
import { orderRoutes } from "./modules/orders/routes";
import { promotionRoutes } from "./modules/promotions/routes";
import { ratingRoutes } from "./modules/ratings/routes";
import { reportRoutes } from "./modules/reports/routes";
import { DEFAULT_SETTLEMENT_CONFIG } from "./modules/billing/settlements";
import { applyRefundToClaim } from "./modules/claims/service";
import { onPaidOrderCancelled } from "./modules/orders/service";
import { payPageRoutes } from "./modules/payments/pay-page";
import { paymentRoutes } from "./modules/payments/routes";
import { onRefundSettled, type PaymentsContext, refundCancelledOrder } from "./modules/payments/service";
import type { TokenVerifier } from "./modules/identity/token-verifier";

export interface AppDeps {
  /** `limits` ausente = sin límites anti-abuso (tests); `server.ts` siempre los pasa. */
  config: Pick<Config, "env" | "logLevel" | "corsOrigins" | "orderTokenSecret"> &
    Partial<Pick<Config, "orders" | "push" | "trustProxyHops" | "limits" | "settlement" | "media">>;
  db: Db;
  tokenVerifier: TokenVerifier;
  /** Pagos con tarjeta (ADR 0021). Ausente = apagados. Los tests pasan un proveedor falso. */
  payments?: { ctx: PaymentsContext; webhookSecret: string | null; panelUrl: string } | null;
}

export const API_VERSION = "0.1.0";

/**
 * Construye la app sin abrir puertos. `server.ts` la pone a escuchar;
 * los tests la usan con `app.inject()`.
 */
export async function buildApp({ config, db, tokenVerifier, payments = null }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logLevel === "silent" ? false : { level: config.logLevel },
    // Correlation ID: se respeta el x-request-id entrante o se genera uno (SPEC §16).
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    // Solo detrás de un proxy conocido: si no, cualquiera falsea su IP con x-forwarded-for.
    trustProxy: config.trustProxyHops ? (_address: string, hop: number) => hop < config.trustProxyHops! : false,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  // Métodos explícitos: @fastify/cors permite solo GET/HEAD/POST por defecto y el navegador
  // frenaría los PATCH/PUT/DELETE (disponibilidad, ubicación del repartidor, paneles).
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    credentials: false,
  });
  // Límites por IP en memoria (ADR 0010): se activan por ruta con `config.rateLimit`.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, ctx) =>
      tooManyRequests("Hiciste demasiados pedidos seguidos. Esperá unos minutos y probá de nuevo.", {
        reason: "IP_RATE_LIMIT",
        retryAfterSeconds: Math.ceil(ctx.ttl / 1000),
      }),
  });

  // Fotos (ADR 0017): un archivo por request, con tope de tamaño.
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } });
  if (config.media) {
    configureMedia(config.media.driver === "supabase" ? createSupabaseStorage(config.media) : createLocalStorage(config.media.dir));
  }

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

  // Almacenamiento local (desarrollo): la API sirve las fotos. Rutas inmutables → caché larga.
  app.get("/media/*", { schema: { hide: true } }, async (request, reply) => {
    if (!media.canServe()) return reply.code(404).send();
    const path = (request.params as { "*": string })["*"];
    const bytes = await media.read(path).catch(() => null);
    if (!bytes) return reply.code(404).send();
    return reply
      .header("content-type", "image/webp")
      .header("cache-control", "public, max-age=31536000, immutable")
      // Helmet pone same-origin: el panel (:3001) y Expo web (:8081) no podrían mostrarlas.
      .header("cross-origin-resource-policy", "cross-origin")
      .send(bytes);
  });

  await app.register(identityRoutes, { prefix: "/v1", db });
  await app.register(geographyRoutes, { prefix: "/v1", db });
  await app.register(catalogRoutes, { prefix: "/v1", db });
  await app.register(merchantRoutes, { prefix: "/v1", db });
  await app.register(menuRoutes, { prefix: "/v1", db });
  // Reparto → pedidos: eventos en la misma transacción (SPEC §9.0, ADR 0014).
  onDeliveryStatusChange(applyDeliveryEvent);
  await app.register(deliveryRoutes, { prefix: "/v1", db });
  await app.register(billingRoutes, { prefix: "/v1", db, settlement: config.settlement });
  await app.register(orderRoutes, {
    prefix: "/v1",
    db,
    orderTokenSecret: config.orderTokenSecret,
    acceptTimeoutMs: config.orders?.acceptTimeoutMs,
    limits: config.limits,
  });
  await app.register(promotionRoutes, { prefix: "/v1", db });
  await app.register(ratingRoutes, { prefix: "/v1", db });
  await app.register(claimRoutes, { prefix: "/v1", db, orderTokenSecret: config.orderTokenSecret });
  await app.register(reportRoutes, { prefix: "/v1", db, timeZone: (config.settlement ?? DEFAULT_SETTLEMENT_CONFIG).timeZone });
  await app.register(notificationRoutes, { prefix: "/v1", db, vapidPublicKey: config.push?.vapid?.publicKey ?? null });
  // Pedidos → pagos (pedido pagado que no sigue: devolución) y pagos → reclamos (devolución
  // confirmada o rechazada). Listeners para no crear ciclos entre módulos (ADR 0021).
  onPaidOrderCancelled(refundCancelledOrder);
  onRefundSettled(applyRefundToClaim);
  await app.register(paymentRoutes, {
    prefix: "/v1",
    db,
    orderTokenSecret: config.orderTokenSecret,
    ctx: payments?.ctx ?? null,
    webhookSecret: payments?.webhookSecret ?? null,
    panelUrl: payments?.panelUrl ?? "http://localhost:3000",
  });
  // Pantalla de pago (Card Payment Brick): fuera de /v1 porque es HTML, no API.
  await app.register(payPageRoutes);

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
