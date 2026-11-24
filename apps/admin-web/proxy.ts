import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Chequeo optimista de sesión; la validación real la hace la API en cada request.
 * - Con Supabase: refresca la sesión (rota el access token y reescribe las cookies) y,
 *   sin usuario, manda al login.
 * - Sin Supabase (desarrollo): solo mira la cookie del token pegado a mano.
 * El nombre de la cookie se repite acá porque `lib/session` es server-only.
 */
const SESSION_COOKIE = "pedilo_admin_token";

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    if (!request.cookies.has(SESSION_COOKIE)) return toLogin(request);
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookieOptions: { name: "sb-pedilo-admin" }, // mismo nombre que lib/supabase.ts
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        for (const [h, v] of Object.entries(headers)) response.headers.set(h, v);
      },
    },
  });

  // getClaims verifica la firma del token (JWKS) y lo refresca si venció.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return toLogin(request);
  return response;
}

function toLogin(request: NextRequest) {
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|auth/|_next/static|_next/image|favicon.ico).*)"],
};
