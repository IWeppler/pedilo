import { type NextRequest, NextResponse } from "next/server";

/**
 * Chequeo optimista: sin cookie de sesión, al login. La validación real (token vigente y
 * rol ADMIN) la hacen la API y `getCurrentAdmin()` en cada request.
 * No se importa `lib/session` porque es server-only; el nombre de la cookie se repite acá.
 */
const SESSION_COOKIE = "pedilo_admin_token";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
