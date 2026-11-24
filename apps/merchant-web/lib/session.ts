import "server-only";

import { cookies } from "next/headers";

import { createSupabaseServer, supabaseEnv } from "./supabase";

/**
 * Sesión del panel del comercio (ADR 0004).
 * - Con Supabase: el access token sale de la sesión de Supabase (cookies de `@supabase/ssr`).
 *   No se valida acá: lo verifica la API en cada request.
 * - Sin Supabase (desarrollo): token pegado a mano, guardado en una cookie httpOnly propia.
 *   Cookie distinta a la del admin para que ambas sesiones convivan en localhost.
 */
export const SESSION_COOKIE = "pedilo_merchant_token";
const MAX_AGE_SECONDS = 60 * 60 * 12;

export async function getToken(): Promise<string | null> {
  if (supabaseEnv()) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

/** Solo modo desarrollo, desde Server Actions o Route Handlers. */
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
  if (supabaseEnv()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut({ scope: "local" });
  }
  (await cookies()).delete(SESSION_COOKIE);
}
