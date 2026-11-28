import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/supabase";

/**
 * Vuelta del link de «Olvidé mi contraseña»: canjea el `code` por una sesión y lleva a elegir la
 * contraseña nueva. Tiene que abrirse en el mismo navegador donde se pidió el link.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/reset-password", request.url));
  }
  return NextResponse.redirect(new URL("/login?modo=recuperar&reason=recovery", request.url));
}
