import { formatARS, VEHICLE_LABELS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { adminCall } from "@/lib/api";
import { cn } from "@/lib/utils";

import { CourierReview } from "./courier-review";

const TABS = ["PENDING_REVIEW", "APPROVED", "SUSPENDED", "REJECTED"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { PENDING_REVIEW: "En revisión", APPROVED: "Aprobados", SUSPENDED: "Suspendidos", REJECTED: "Rechazados" };

export default function CouriersPage({ searchParams }: PageProps<"/couriers">) {
  return (
    <>
      <PageHeader
        title="Repartidores"
        description="Verificá identidad y vehículo antes de aprobar. Solo los aprobados reciben ofertas de su ciudad."
      />
      <Suspense fallback={<TableSkeleton />}>
        <CouriersSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function CouriersSection({ searchParams }: { searchParams: PageProps<"/couriers">["searchParams"] }) {
  const raw = (await searchParams).status;
  const status: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "PENDING_REVIEW";
  const [couriers, cities] = await Promise.all([
    adminCall((api) => api.GET("/v1/admin/couriers", { params: { query: { status } } })),
    adminCall((api) => api.GET("/v1/admin/cities")),
  ]);
  const cityName = new Map(cities.map((c) => [c.id, c.name]));

  return (
    <div className="grid gap-4">
      <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:w-fit" aria-label="Estado">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/couriers?status=${tab}`}
            aria-current={tab === status ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              tab === status ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LABELS[tab]}
          </Link>
        ))}
      </nav>
      {couriers.length === 0 && <p className="text-sm text-muted-foreground">No hay repartidores en este estado.</p>}
      {couriers.map((c) => (
        <Card key={c.id}>
          <CardContent className="grid gap-3 pt-4 md:grid-cols-[1fr_auto]">
            <div className="grid gap-1 text-sm">
              <p className="font-medium">
                {c.displayName} · {VEHICLE_LABELS[c.vehicle]} · {cityName.get(c.cityId) ?? "—"}
              </p>
              <p className="text-muted-foreground">
                <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">
                  {c.phone}
                </a>{" "}
                · tarifa mínima {formatARS(c.minFeeMinor)} · registrado {formatDateTime(c.createdAt)}
                {c.lastSeenAt && ` · visto ${formatDateTime(c.lastSeenAt)}`}
                {c.status === "APPROVED" && (c.available ? " · disponible" : " · no disponible")}
              </p>
              {c.statusReason && <p className="text-muted-foreground">Motivo: {c.statusReason}</p>}
            </div>
            <CourierReview courierId={c.id} status={c.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
