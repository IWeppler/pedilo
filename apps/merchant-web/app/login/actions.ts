"use server";

import { ApiError, unwrap } from "@pedilo/api-client";
import type { FormState } from "@pedilo/web-utils";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { API_URL, apiClient } from "@/lib/api";
import { clearToken, setToken } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Login con Supabase Auth (ADR 0004): se manda un link de acceso al email. Si la cuenta no
 * existe se crea, así un comercio nuevo se registra con el mismo paso.
 */
export async function sendLoginLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { fieldErrors: { email: "Ingresá un email válido" }, values: { email } };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback`, shouldCreateUser: true },
  });
  if (error) {
    const message =
      error.status === 429
        ? "Pediste demasiados links. Esperá unos minutos y probá de nuevo."
        : "No se pudo enviar el email. Probá de nuevo.";
    return { message, values: { email } };
  }
  return { saved: true, values: { email } };
}

/**
 * Login de desarrollo (sin Supabase): se pega un token de
 * `npm run dev:token -w @pedilo/api -- --name <nombre>` y se valida contra la API antes de guardarlo.
 */
export async function loginWithToken(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { fieldErrors: { token: "Pegá un token" } };

  try {
    await unwrap(apiClient(token).GET("/v1/me"));
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) return { message: "Token inválido o vencido." };
    if (err instanceof ApiError && err.isForbidden) return { message: "Usuario suspendido." };
    return { message: `No se pudo conectar con la API (${API_URL}). ¿Está corriendo?` };
  }

  await setToken(token);
  redirect("/");
}

export async function logout() {
  await clearToken();
  redirect("/login");
}

/** Origen público del panel, para armar el link del email. */
async function siteOrigin(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}
