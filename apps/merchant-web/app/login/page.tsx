import Link from "next/link";
import { Suspense } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { supabaseEnv } from "@/lib/supabase";

import { DevTokenForm, type LoginMode, SupabaseLoginForm } from "./login-form";

const REASONS: Record<string, string> = {
  expired: "Tu sesión venció. Entrá de nuevo.",
  link: "El link no es válido o ya se usó. Pedí uno nuevo y abrilo en este mismo navegador.",
  recovery: "El link para cambiar la contraseña no es válido o ya venció. Pedí uno nuevo.",
  oauth: "No se pudo completar el ingreso con Google. Probá de nuevo o entrá con tu email.",
};

/** Foto del panel derecho: va en `public/` con este nombre. Sin el archivo queda el fondo de color. */
const HERO_IMAGE = "/login-hero.jpg";

type SearchParams = PageProps<"/login">["searchParams"];

/**
 * Ingreso y registro de comercios: a la izquierda el formulario (Google o email y contraseña), a
 * la derecha una foto con lo que ofrece Pedilo (solo en pantallas grandes).
 * `?modo=registro` crea la cuenta y `?modo=recuperar` pide el link para cambiar la contraseña.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-svh flex-1 lg:grid-cols-2">
      <section className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/login" className="flex w-fit items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background">P</span>
          Pedilo Comercios
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">
            <Suspense fallback={<FormSkeleton />}>
              <LoginContent searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </section>

      <aside
        className="relative hidden overflow-hidden bg-zinc-800 bg-cover bg-center lg:block"
        style={{ backgroundImage: `url(${HERO_IMAGE})` }}
        aria-hidden
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="absolute inset-x-8 bottom-8 rounded-2xl border border-white/25 bg-white/15 p-7 text-white backdrop-blur-md">
          <p className="text-2xl leading-snug font-medium text-balance">
            Recibí pedidos de tu ciudad, con repartidores de la zona o para retirar en el local.
          </p>
          <ul className="mt-5 grid gap-1.5 text-sm text-white/85">
            <li>Comisión con tope por pedido, sin sorpresas.</li>
            <li>Liquidación semanal con el detalle de cada pedido.</li>
            <li>Tu catálogo, tus horarios y tus zonas de envío.</li>
          </ul>
        </div>
      </aside>
    </main>
  );
}

const COPY: Record<LoginMode, { title: string; subtitle: string; footer?: { text: string; href: string; link: string } }> = {
  ingreso: {
    title: "Hola de nuevo",
    subtitle: "Entrá para gestionar tu comercio.",
    footer: { text: "¿No tenés cuenta? ", href: "/login?modo=registro", link: "Registrate gratis" },
  },
  registro: {
    title: "Sumá tu comercio",
    subtitle: "Creá tu cuenta gratis y empezá a recibir pedidos.",
    footer: { text: "¿Ya tenés cuenta? ", href: "/login", link: "Ingresá" },
  },
  recuperar: {
    title: "Cambiá tu contraseña",
    subtitle: "Te mandamos un link a tu email para elegir una nueva.",
    footer: { text: "¿Te acordaste? ", href: "/login", link: "Volver a ingresar" },
  },
};

async function LoginContent({ searchParams }: { searchParams: SearchParams }) {
  const { reason, modo } = await searchParams;
  const mode: LoginMode = modo === "registro" || modo === "recuperar" ? modo : "ingreso";
  const copy = COPY[mode];
  const message = typeof reason === "string" ? REASONS[reason] : undefined;
  const supabase = supabaseEnv() !== null;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {supabase ? <SupabaseLoginForm key={mode} mode={mode} /> : <DevTokenForm />}

      {supabase && copy.footer ? (
        <p className="text-center text-sm text-muted-foreground">
          {copy.footer.text}
          <Link
            href={copy.footer.href}
            className="font-medium text-foreground underline decoration-2 underline-offset-4 hover:decoration-primary"
          >
            {copy.footer.link}
          </Link>
        </p>
      ) : (
        !supabase && (
          <p className="text-xs text-muted-foreground">
            Modo desarrollo: configurá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para entrar con Google o email.
          </p>
        )
      )}
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="mt-4 h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}
