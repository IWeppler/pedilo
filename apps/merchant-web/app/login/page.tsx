import { Suspense } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Pedilo para comercios</CardTitle>
          <CardDescription>Entrá para gestionar tu comercio.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Suspense>
            <ExpiredMessage searchParams={searchParams} />
          </Suspense>
          <LoginForm />
          <p className="text-xs text-muted-foreground">
            Modo desarrollo. El ingreso con teléfono o email se habilita cuando se configure Supabase Auth.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

async function ExpiredMessage({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { reason } = await searchParams;
  if (reason !== "expired") return null;
  return (
    <Alert>
      <AlertDescription>Tu sesión venció. Entrá de nuevo.</AlertDescription>
    </Alert>
  );
}
