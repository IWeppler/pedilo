import "server-only";

import { cookies } from "next/headers";

/**
 * Sesión del panel del comercio: token de acceso en cookie httpOnly. Hoy es un token de
 * desarrollo; con Supabase será el access token de la sesión (ADR 0004).
 * Cookie distinta a la del admin para que ambas sesiones convivan en localhost.
 */
export const SESSION_COOKIE = "pedilo_merchant_token";
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
