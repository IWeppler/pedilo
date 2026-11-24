"use server";

import { ApiError, unwrap } from "@pedilo/api-client";
import type { FormState } from "@pedilo/web-utils";
import { redirect } from "next/navigation";

import { API_URL, apiClient } from "@/lib/api";
import { clearToken, setToken } from "@/lib/session";

/**
 * Login de desarrollo: se pega un token de `npm run dev:token -w @pedilo/api -- --name <nombre>`.
 * Se valida contra la API antes de guardarlo. Con Supabase se reemplaza por login con teléfono o email.
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
