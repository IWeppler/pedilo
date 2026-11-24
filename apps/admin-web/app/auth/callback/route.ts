import { type NextRequest, NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/supabase";

/**
 * Destino del link del email (flujo PKCE de Supabase): canjea el `code` por la sesión.
 * Tiene que abrirse en el mismo navegador donde se pidió el link.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/merchants", request.url));
  }
  return NextResponse.redirect(new URL("/login?reason=link", request.url));
}
