import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { MerchantStatusBadge } from "@/components/merchant-status-badge";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";

export default function HomePage() {
  return (
    <Suspense fallback={<TableSkeleton rows={3} />}>
      <MyMerchants />
    </Suspense>
  );
}

async function MyMerchants() {
  const merchants = await merchantCall((api) => api.GET("/v1/me/merchants"));

  // Con un solo comercio se va directo a su panel: a Pedidos si ya está aprobado.
  if (merchants.length === 1) {
    const only = merchants[0]!;
    redirect(only.status === "APPROVED" ? `/m/${only.id}/orders` : `/m/${only.id}`);
  }

  if (merchants.length === 0) {
    return (
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle>Vendé con Pedilo</CardTitle>
          <CardDescription>
            Registrá tu comercio, cargá tu local con horarios y formas de entrega, y lo revisamos para que puedas
            empezar a recibir pedidos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/onboarding" className={buttonVariants({ size: "lg" })}>
            Registrar mi comercio
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Tus comercios"
        actions={
          <Link href="/onboarding" className={buttonVariants({ variant: "outline" })}>
            Registrar otro
          </Link>
        }
      />
      <div className="grid gap-3">
        {merchants.map((m) => (
          <Link key={m.id} href={m.status === "APPROVED" ? `/m/${m.id}/orders` : `/m/${m.id}`} className="rounded-xl border p-4 transition-colors hover:bg-muted">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{m.displayName}</span>
              <MerchantStatusBadge status={m.status} />
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
