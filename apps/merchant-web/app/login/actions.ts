"use server";

import { ApiError, unwrap } from "@pedilo/api-client";
import type { FormState } from "@pedilo/web-utils";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { API_URL, apiClient } from "@/lib/api";
import { clearToken, setToken } from "@/lib/session";
import { createSupabaseServer } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD = 8;

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    password: String(formData.get("password") ?? ""),
  };
}

/**
 * Ingreso con email y contraseña por Supabase Auth (ADR 0004). Los comercios no entran con link
 * ni código: eso queda para repartidores (y clientes).
 */
export async function loginWithPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const { email, password } = readCredentials(formData);
  const values = { email };
  if (!EMAIL_RE.test(email)) return { fieldErrors: { email: "Ingresá un email válido" }, values };
  if (!password) return { fieldErrors: { password: "Ingresá tu contraseña" }, values };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    if (error?.code === "email_not_confirmed") {
      return { message: "Todavía no confirmaste tu email. Abrí el link que te mandamos al crear la cuenta.", values };
    }
    const message =
      error?.status === 429
        ? "Demasiados intentos. Esperá unos minutos y probá de nuevo."
        : // Mismo mensaje para email inexistente o contraseña incorrecta: no revela qué cuentas hay.
          "El email o la contraseña no son correctos.";
    return { message, values };
  }
  redirect("/");
}

/**
 * Alta de cuenta con email y contraseña. Si Supabase pide confirmar el email (lo normal), manda un
 * link que vuelve a `/auth/callback` y de ahí al registro del comercio.
 */
export async function signUpWithPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const { email, password } = readCredentials(formData);
  const confirm = String(formData.get("confirmPassword") ?? "");
  const values = { email };
  if (!EMAIL_RE.test(email)) return { fieldErrors: { email: "Ingresá un email válido" }, values };
  if (password.length < MIN_PASSWORD) {
    return { fieldErrors: { password: `Usá al menos ${MIN_PASSWORD} caracteres` }, values };
  }
  if (password !== confirm) return { fieldErrors: { confirmPassword: "Las contraseñas no coinciden" }, values };

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error) {
    if (error.code === "weak_password") return { fieldErrors: { password: "Esa contraseña es muy fácil de adivinar" }, values };
    if (error.code === "user_already_exists") return { message: "Ya hay una cuenta con ese email. Ingresá o recuperá tu contraseña.", values };
    if (error.status === 429) return { message: "Demasiados intentos. Esperá unos minutos y probá de nuevo.", values };
    return { message: "No se pudo crear la cuenta. Probá de nuevo.", values };
  }
  // Con la confirmación de email desactivada en Supabase la sesión ya viene: directo al registro.
  if (data.session) redirect("/");
  // Email ya registrado: Supabase responde «ok» sin mandar nada (para no revelar cuentas) y
  // devuelve el usuario sin identidades. Mejor decirlo que esperar un código que no llega.
  if (data.user && data.user.identities?.length === 0) {
    return { message: "Ya hay una cuenta con ese email. Ingresá con tu contraseña o usá «¿La olvidaste?».", values };
  }
  return { saved: true, values };
}

/**
 * Confirmación de la cuenta nueva con el código del email (si la plantilla «Confirm signup» de
 * Supabase manda `{{ .Token }}`). Si manda el link, abrirlo hace lo mismo por `/auth/callback`.
 */
export async function verifySignupCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("code") ?? "").replace(/\s+/g, "");
  const values = { email };
  if (!/^\d{6,10}$/.test(token)) return { fieldErrors: { code: "Ingresá el código que te llegó por email" }, values, saved: true };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    const message =
      error.status === 429
        ? "Demasiados intentos. Esperá unos minutos y probá de nuevo."
        : "El código no es correcto o ya venció. Revisá el último email que te llegó.";
    return { fieldErrors: { code: message }, values, saved: true };
  }
  redirect("/");
}

/** Reenvía el email de confirmación de la cuenta. */
export async function resendSignupCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });
  if (error?.status === 429) return { message: "Esperá un minuto antes de pedir otro email.", values: { email }, saved: true };
  if (error) return { message: "No se pudo reenviar el email. Probá de nuevo en un rato.", values: { email }, saved: true };
  return { message: "Listo: si la cuenta todavía no está confirmada, te llega otro email.", values: { email }, saved: true };
}

/**
 * «Olvidé mi contraseña»: manda un link que vuelve a `/auth/recovery` y de ahí a elegir una nueva.
 * Siempre responde igual, exista o no la cuenta. También sirve para quien entraba con link y
 * nunca tuvo contraseña.
 */
export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const values = { email };
  if (!EMAIL_RE.test(email)) return { fieldErrors: { email: "Ingresá un email válido" }, values };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await siteOrigin()}/auth/recovery` });
  if (error?.status === 429) return { message: "Pediste demasiados emails. Esperá unos minutos y probá de nuevo.", values };
  return { saved: true, values };
}

/** Nueva contraseña, con la sesión que dejó el link de recuperación. */
export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (password.length < MIN_PASSWORD) return { fieldErrors: { password: `Usá al menos ${MIN_PASSWORD} caracteres` } };
  if (password !== confirm) return { fieldErrors: { confirmPassword: "Las contraseñas no coinciden" } };

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "weak_password") return { fieldErrors: { password: "Esa contraseña es muy fácil de adivinar" } };
    if (error.code === "same_password") return { fieldErrors: { password: "Tiene que ser distinta de la anterior" } };
    if (error.status === 401 || error.code === "session_not_found") {
      return { message: "El link venció. Pedí uno nuevo desde «Olvidé mi contraseña»." };
    }
    return { message: "No se pudo guardar la contraseña. Probá de nuevo." };
  }
  redirect("/");
}

/**
 * Login (o registro) con Google por Supabase Auth: lleva a Google y vuelve a `/auth/callback`,
 * que canjea el código igual que con el link del email. La cuenta se crea la primera vez.
 * El proveedor se habilita en Supabase → Authentication → Sign In / Providers → Google.
 */
export async function signInWithGoogle(): Promise<FormState> {
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteOrigin()}/auth/callback`, queryParams: { prompt: "select_account" } },
  });
  if (error || !data.url) return { message: "No se pudo iniciar el ingreso con Google. Probá de nuevo." };
  redirect(data.url);
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

/** Origen público del panel, para los links de los emails y la vuelta de Google. */
async function siteOrigin(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}
