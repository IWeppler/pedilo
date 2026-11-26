import "server-only";

import { type ApiClient, ApiError, createApiClient, type Me, unwrap } from "@pedilo/api-client";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { getToken } from "./session";

/**
 * Acceso a la API desde el panel del comercio. Toda regla de negocio y permiso vive en la API;
 * acá solo se adjunta el token y se manejan sesión vencida y "no encontrado".
 */
export const API_URL = process.env.API_URL ?? "http://localhost:4000";

export function apiClient(token?: string | null): ApiClient {
  return createApiClient({ baseUrl: API_URL, getToken: async () => token ?? (await getToken()) });
}

type Call<T> = (api: ApiClient) => Promise<{ data?: T; error?: unknown; response: Response }>;

/**
 * Llamada autenticada. Sesión vencida → login. Un 404 (comercio ajeno o inexistente) → página 404.
 * Otros errores siguen (Server Actions los traducen al formulario; páginas → error boundary).
 */
export async function merchantCall<T>(call: Call<T>, opts: { notFoundOn404?: boolean } = {}): Promise<T> {
  // Siempre en tiempo de request (y openapi-fetch usa Math.random, que Cache Components no permite al prerenderizar).
  await connection();
  const token = await getToken();
  if (!token) redirect("/login");

  let expired = false;
  try {
    return await unwrap(call(apiClient(token)));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.isUnauthorized) expired = true;
    else if (opts.notFoundOn404 && (err.status === 404 || err.status === 400)) notFound();
    else throw err;
  }
  if (expired) redirect("/login?reason=expired");
  throw new Error("inalcanzable");
}

/**
 * Subida de una foto (multipart) a la API, con la misma sesión que `merchantCall`. openapi-fetch
 * no arma multipart, por eso va con fetch directo. Devuelve el JSON de la respuesta.
 */
export async function merchantUpload<T>(path: string, file: File): Promise<T> {
  await connection();
  const token = await getToken();
  if (!token) redirect("/login");
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}${path}`, { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body });
  if (res.status === 401) redirect("/login?reason=expired");
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? "HTTP_ERROR", json?.error?.message ?? `HTTP ${res.status}`, json?.error?.details);
  return json as T;
}

export async function getCurrentUser(): Promise<Me> {
  return merchantCall((api) => api.GET("/v1/me"));
}

/** Detalle del comercio del usuario; 404 si no es miembro. */
export function getMyMerchant(merchantId: string) {
  return merchantCall((api) => api.GET("/v1/merchants/{merchantId}", { params: { path: { merchantId } } }), {
    notFoundOn404: true,
  });
}

/** Rubros y ciudades públicas (activas) para los selects de los formularios. */
export async function getReferenceData() {
  const [rubros, cities] = await Promise.all([
    merchantCall((api) => api.GET("/v1/categories", { params: { query: { kind: "MERCHANT" } } })),
    merchantCall((api) => api.GET("/v1/cities")),
  ]);
  return { rubros, cities };
}

/** ¿Se pueden modificar datos operativos (sucursales, horarios, zonas)? */
export function operationsLocked(status: string): string | null {
  if (status === "PENDING_REVIEW") return "Tu comercio está en revisión. Vas a poder editar cuando el equipo de Pedilo responda.";
  if (status === "SUSPENDED") return "Tu comercio está suspendido. Contactá al equipo de Pedilo.";
  return null;
}
