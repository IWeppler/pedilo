import Link from "next/link";

import { ResetPasswordForm } from "./reset-password-form";

/**
 * Elegir una contraseña nueva, con la sesión que dejó el link de recuperación (`/auth/recovery`).
 * Sin sesión, `proxy.ts` manda al login.
 */
export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-svh flex-1 flex-col px-6 py-8 sm:px-10">
      <Link href="/login" className="flex w-fit items-center gap-2 font-semibold">
        <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background">P</span>
        Pedilo Comercios
      </Link>
      <div className="flex flex-1 items-center justify-center py-10">
        <div className="grid w-full max-w-sm gap-6">
          <div className="grid gap-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">Elegí tu contraseña nueva</h1>
            <p className="text-sm text-muted-foreground">Después entrás directo a tu comercio.</p>
          </div>
          <ResetPasswordForm />
        </div>
      </div>
    </main>
  );
}
