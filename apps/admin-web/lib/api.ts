import "server-only";

import { type ApiClient, ApiError, createApiClient, type Me, unwrap } from "@pedilo/api-client";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getToken } from "./session";

/**
 * Capa de acceso a datos del panel. Todo pasa por la API (ADR 0005): el panel no tiene
 * lógica de negocio ni acceso a la base. La API vuelve a validar permisos en cada request.
 */
export const API_URL = process.env.API_URL ?? "http://localhost:4000";

export function apiClient(token?: string | null): ApiClient {
  return createApiClient({ baseUrl: API_URL, getToken: async () => token ?? (await getToken()) });
}

type Call<T> = (api: ApiClient) => Promise<{ data?: T; error?: unknown; response: Response }>;

/**
 * Ejecuta una llamada autenticada. Si la sesión venció o el usuario dejó de ser admin,
 * manda al login con el motivo; cualquier otro error sigue de largo (error boundary).
 */
export async function adminCall<T>(call: Call<T>): Promise<T> {
  // Siempre en tiempo de request: los datos del panel nunca se prerenderizan, y openapi-fetch
  // usa Math.random() internamente (Cache Components lo rechaza durante el prerender).
  await connection();
  const token = await getToken();
  if (!token) redirect("/login");

  let reason: "expired" | "forbidden";
  try {
    return await unwrap(call(apiClient(token)));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.isUnauthorized) reason = "expired";
    else if (err.isForbidden) reason = "forbidden";
    else throw err;
  }
  redirect(`/login?reason=${reason}`);
}

/** Usuario actual; redirige al login si no hay sesión válida de admin. */
export async function getCurrentAdmin(): Promise<Me> {
  const me = await adminCall((api) => api.GET("/v1/me"));
  if (me.platformRole !== "ADMIN") redirect("/login?reason=forbidden");
  return me;
}
