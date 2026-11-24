import "server-only";

import { cookies } from "next/headers";

/**
 * Sesión del panel: el token de acceso vive en una cookie httpOnly (el JS del navegador
 * no la puede leer). Hoy guarda un token de desarrollo; con Supabase guardará el access
 * token de la sesión (ADR 0004).
 */
export const SESSION_COOKIE = "pedilo_admin_token";
const MAX_AGE_SECONDS = 60 * 60 * 12;

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Solo desde Server Actions o Route Handlers. */
export async function setToken(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Solo desde Server Actions o Route Handlers. */
export async function clearToken() {
  (await cookies()).delete(SESSION_COOKIE);
}
