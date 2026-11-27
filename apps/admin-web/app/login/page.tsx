import { Suspense } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseEnv } from "@/lib/supabase";

import { DevTokenForm, EmailLoginForm } from "./login-form";

const REASONS: Record<string, string> = {
  expired: "Tu sesión venció. Entrá de nuevo.",
  forbidden: "Ese usuario no tiene permisos de administrador.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  const supabase = supabaseEnv() !== null;
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Pedilo Admin</CardTitle>
          <CardDescription>Acceso para el equipo de Pedilo.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Suspense>
            <ReasonMessage searchParams={searchParams} />
          </Suspense>
          {supabase ? <EmailLoginForm /> : <DevTokenForm />}
          {!supabase && (
            <p className="text-xs text-muted-foreground">
              Modo desarrollo: configurá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para entrar con email.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

async function ReasonMessage({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { reason } = await searchParams;
  const message = typeof reason === "string" ? REASONS[reason] : undefined;
  if (!message) return null;
  return (
    <Alert>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
