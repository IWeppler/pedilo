import { type NextRequest, NextResponse } from "next/server";

/**
 * Chequeo optimista: sin cookie de sesión, al login. La validación real la hace la API.
 * El nombre de la cookie se repite acá porque `lib/session` es server-only.
 */
const SESSION_COOKIE = "pedilo_merchant_token";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
