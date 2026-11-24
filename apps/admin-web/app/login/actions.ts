"use server";

import { ApiError, unwrap } from "@pedilo/api-client";
import { redirect } from "next/navigation";

import { API_URL, apiClient } from "@/lib/api";
import type { FormState } from "@pedilo/web-utils";
import { clearToken, setToken } from "@/lib/session";

/**
 * Login de desarrollo: se pega un token de `npm run dev:token -w @pedilo/api -- --admin`.
 * Se valida contra la API antes de guardarlo. Con Supabase configurado, este paso lo
 * reemplaza el login por email/OTP (pendiente: ADR 0004).
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
