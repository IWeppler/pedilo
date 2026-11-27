"use server";

import { ApiError, unwrap } from "@pedilo/api-client";
import type { FormState } from "@pedilo/web-utils";
import { redirect } from "next/navigation";

import { API_URL, apiClient } from "@/lib/api";
import { clearToken, setToken } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Login con Supabase Auth (ADR 0004): email y contraseña. Acá no se crean cuentas ni se dan
 * roles: el rol ADMIN se da con `npm run admin:grant` y lo verifica la API en cada request.
 * Además se chequea al entrar, para no dejar abierta una sesión que no puede usar el panel.
 */
export async function loginWithPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const values = { email };
  if (!EMAIL_RE.test(email)) return { fieldErrors: { email: "Ingresá un email válido" }, values };
  if (!password) return { fieldErrors: { password: "Ingresá tu contraseña" }, values };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    const message =
      error?.status === 429
        ? "Demasiados intentos. Esperá unos minutos y probá de nuevo."
        : // Mismo mensaje para email inexistente o contraseña incorrecta: no revela qué cuentas hay.
          "El email o la contraseña no son correctos.";
    return { message, values };
  }

  try {
    const me = await unwrap(apiClient(data.session.access_token).GET("/v1/me"));
    if (me.platformRole !== "ADMIN") {
      await supabase.auth.signOut();
      return { message: "Esta cuenta no tiene permisos de administrador.", values };
    }
  } catch {
    await supabase.auth.signOut();
    return { message: `No se pudo conectar con la API (${API_URL}). ¿Está corriendo?`, values };
  }
  redirect("/merchants");
}

/**
 * Login de desarrollo (sin Supabase): se pega un token de `npm run dev:token -w @pedilo/api -- --admin`
 * y se valida contra la API antes de guardarlo.
 */
export async function loginWithToken(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { fieldErrors: { token: "Pegá un token" } };

  try {
    const me = await unwrap(apiClient(token).GET("/v1/me"));
    if (me.platformRole !== "ADMIN") {
      return { message: `El usuario ${me.email ?? me.id} no tiene rol ADMIN.` };
    }
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) return { message: "Token inválido o vencido." };
    if (err instanceof ApiError && err.isForbidden) return { message: "Usuario suspendido." };
    return { message: `No se pudo conectar con la API (${API_URL}). ¿Está corriendo?` };
  }

  await setToken(token);
  redirect("/merchants");
}

export async function logout() {
  await clearToken();
  redirect("/login");
}
