import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";

import sharp, { type Metadata } from "sharp";

import { badRequest } from "./errors";

/**
 * Fotos (ADR 0017): productos, logo y portada del comercio.
 *
 * - Siempre se reprocesan con sharp: se corrige la orientación, se descartan los metadatos
 *   (incluida la ubicación GPS de las fotos del celular), se achican y se guardan en WebP.
 * - Dónde se guardan es intercambiable: disco local en desarrollo (servido por la API en
 *   `/media/...`) o Supabase Storage en producción (bucket público).
 * - Las DTOs exponen URLs. En modo local son relativas (`/media/...`): cada cliente las resuelve
 *   contra la URL de la API que ya usa (localhost en la PC, la IP de la red en el celular).
 */

export interface MediaStorage {
  put(path: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
  url(path: string): string;
  /** Solo el disco local: la API sirve los archivos. */
  read?(path: string): Promise<Buffer | null>;
}

export function createLocalStorage(dir: string): MediaStorage {
  const root = resolve(dir);
  const full = (path: string) => {
    const target = resolve(root, normalize(path));
    // Nunca fuera de la carpeta (p. ej. "../../.env").
    if (target !== root && !target.startsWith(root + sep)) throw badRequest("Ruta inválida");
    return target;
  };
  return {
    async put(path, bytes) {
      const target = full(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
    async remove(path) {
      await rm(full(path), { force: true });
    },
    url: (path) => `/media/${path}`,
    async read(path) {
      try {
        return await readFile(full(path));
      } catch {
        return null;
      }
    },
  };
}

/**
 * Supabase Storage por su API REST, con la clave secreta (solo en el servidor). El bucket tiene
 * que existir y ser público: las fotos del menú son públicas por naturaleza.
 */
export function createSupabaseStorage(opts: { url: string; secretKey: string; bucket: string }): MediaStorage {
  const base = `${opts.url}/storage/v1/object`;
  const headers = { apikey: opts.secretKey, Authorization: `Bearer ${opts.secretKey}` };
  return {
    async put(path, bytes, contentType) {
      const res = await fetch(`${base}/${opts.bucket}/${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": contentType, "x-upsert": "true", "cache-control": "max-age=31536000" },
        body: new Uint8Array(bytes),
      });
      if (!res.ok) throw new Error(`Supabase Storage respondió ${res.status}: ${await res.text()}`);
    },
    async remove(path) {
      await fetch(`${base}/${opts.bucket}`, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ prefixes: [path] }),
      });
    },
    url: (path) => `${base}/public/${opts.bucket}/${path}`,
  };
}

let storage: MediaStorage = createLocalStorage(".media");

/** Lo fija `app.ts` según la configuración. */
export function configureMedia(next: MediaStorage) {
  storage = next;
}
export const media = {
  put: (path: string, bytes: Buffer, type: string) => storage.put(path, bytes, type),
  remove: (path: string) => storage.remove(path),
  read: (path: string) => storage.read?.(path) ?? Promise.resolve(null),
  canServe: () => Boolean(storage.read),
};
/** URL pública de una foto guardada (o null). */
export const mediaUrl = (path: string | null | undefined): string | null => (path ? storage.url(path) : null);

// ---------------------------------------------------------------------------
// Procesamiento
// ---------------------------------------------------------------------------

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type ImageKind = "product" | "logo" | "cover";

const SIZES: Record<ImageKind, { width: number; height: number; fit: "inside" | "cover" }> = {
  product: { width: 1200, height: 1200, fit: "inside" },
  logo: { width: 512, height: 512, fit: "cover" },
  cover: { width: 1600, height: 640, fit: "cover" },
};

/** Valida que sea una imagen de verdad (no por la extensión) y la normaliza a WebP. */
export async function processImage(input: Buffer, kind: ImageKind): Promise<Buffer> {
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw badRequest("El archivo no es una imagen válida", { field: "file" });
  }
  if (!meta.format || !["jpeg", "png", "webp", "heif", "avif"].includes(meta.format)) {
    throw badRequest("Formato no soportado: usá JPG, PNG o WebP", { field: "file" });
  }
  if ((meta.width ?? 0) < 200 || (meta.height ?? 0) < 200) {
    throw badRequest("La imagen es muy chica (mínimo 200 × 200)", { field: "file" });
  }
  const size = SIZES[kind];
  return sharp(input)
    .rotate() // orientación según EXIF, antes de descartar los metadatos
    .resize({ width: size.width, height: size.height, fit: size.fit, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

/** Ruta nueva por cada subida: así las cachés (CDN, Expo Image) nunca muestran la foto vieja. */
export function mediaPath(merchantId: string, name: string): string {
  return join("merchants", merchantId, `${name}-${randomBytes(6).toString("hex")}.webp`).split(sep).join("/");
}
