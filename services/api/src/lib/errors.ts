import { z } from "zod";

/**
 * Errores de la API con forma estable (ADR 0005):
 * { "error": { "code": "NOT_FOUND", "message": "…", "details"?: … } }
 * Los clientes dependen de `code`; `message` es solo para humanos.
 */
export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  BAD_REQUEST: "BAD_REQUEST",
  /** Demasiados requests o pedidos (rate limiting). `details.retryAfterSeconds` cuando se conoce. */
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (message = "Autenticación requerida") =>
  new AppError(401, ErrorCode.UNAUTHORIZED, message);
export const forbidden = (message = "No tenés permiso para esta acción") =>
  new AppError(403, ErrorCode.FORBIDDEN, message);
export const notFound = (entity: string) => new AppError(404, ErrorCode.NOT_FOUND, `${entity} no encontrado`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, ErrorCode.CONFLICT, message, details);
export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, ErrorCode.BAD_REQUEST, message, details);
export const tooManyRequests = (message: string, details?: unknown) =>
  new AppError(429, ErrorCode.RATE_LIMITED, message, details);

export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .describe("Error con forma estable (ADR 0005)");

/** Respuestas de error estándar para documentar en OpenAPI. */
export const errorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
  429: errorResponseSchema,
} as const;

/** Detecta violaciones de unicidad de Postgres (directas o envueltas por Drizzle). */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object" && "code" in current && (current as { code: unknown }).code === "23505") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
