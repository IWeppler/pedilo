import type { FastifyRequest } from "fastify";

import { badRequest } from "./errors";
import { MAX_UPLOAD_BYTES } from "./media";

/**
 * Lee el archivo de un request `multipart/form-data` (campo `file`). Lo que se valida acá es el
 * transporte (que haya archivo y no supere el tamaño); que sea una imagen lo valida `processImage`.
 */
export async function readUpload(request: FastifyRequest): Promise<Buffer> {
  if (!request.isMultipart()) throw badRequest("Mandá la imagen como multipart/form-data en el campo «file»", { field: "file" });
  const file = await request.file();
  if (!file || file.fieldname !== "file") throw badRequest("Falta la imagen (campo «file»)", { field: "file" });
  try {
    return await file.toBuffer();
  } catch {
    throw badRequest(`La imagen supera los ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`, { field: "file" });
  }
}

/** Para la documentación OpenAPI de las rutas de subida (el body no pasa por zod). */
export const uploadDescription =
  "Body `multipart/form-data` con la imagen en el campo `file` (JPG, PNG o WebP, hasta 8 MB, mínimo 200 × 200). " +
  "Se reprocesa a WebP y se descartan los metadatos (ADR 0017).";
