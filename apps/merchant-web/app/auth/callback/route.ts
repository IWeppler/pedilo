import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/supabase";

/**
 * Vuelta del link de confirmación de cuenta y del ingreso con Google (flujo PKCE de Supabase): canjea el `code`
 * por la sesión. Tiene que abrirse en el mismo navegador donde se empezó el ingreso.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", request.url));
  }
  // Google (o Supabase) devuelve `error` si el usuario canceló o el proveedor no está habilitado.
  const reason = params.has("error") ? "oauth" : "link";
  return NextResponse.redirect(new URL(`/login?reason=${reason}`, request.url));
}
