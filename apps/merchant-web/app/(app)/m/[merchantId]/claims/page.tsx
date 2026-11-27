import { CLAIM_REASON_LABELS, CLAIM_STATUS_LABELS, type ClaimReason, formatARS } from "@pedilo/domain";
import { formatDateTime, formatMinutes } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = PageProps<"/m/[merchantId]/claims">;

export default function ClaimsPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <Claims params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/** Reclamos de clientes (ADR 0019). Tenés 24 h para proponer una solución; después interviene Pedilo. */
async function Claims({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const scope = query.scope === "all" ? "all" : "open";
  const [list, metrics] = await Promise.all([
    merchantCall((api) => api.GET("/v1/merchants/{merchantId}/claims", { params: { path: { merchantId }, query: { scope } } }), {
      notFoundOn404: true,
    }),
    merchantCall((api) => api.GET("/v1/merchants/{merchantId}/claims/metrics", { params: { path: { merchantId }, query: { days: 30 } } })),
  ]);
  const topReasons = (Object.entries(metrics.byReason) as Array<[ClaimReason, number]>).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Reclamos"
        description="Proponé una solución dentro de las 24 h: si no, el reclamo pasa a Pedilo."
      />
      <Card>
        <CardHeader>
          <CardTitle>Últimos 30 días</CardTitle>
          <CardDescription>
            {metrics.claims === 0
              ? "Sin reclamos."
              : `${metrics.claims} reclamos en ${metrics.completedOrders} pedidos completados${metrics.claimRatePer100 !== null ? ` (${metrics.claimRatePer100} cada 100)` : ""}.`}
          </CardDescription>
        </CardHeader>
        {metrics.claims > 0 && (
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Tiempo hasta tu propuesta" value={formatMinutes(metrics.medianMinutesToProposal)} hint="mediana" />
              <Stat label="Sin respuesta a tiempo" value={String(metrics.slaMissed)} hint="pasaron a Pedilo" />
              <Stat label="Resueltos" value={`${metrics.resolved} de ${metrics.claims}`} />
              <Stat label="Devuelto" value={formatARS(metrics.refundedMinor)} />
            </dl>
            {topReasons.length > 0 && (
              <p className="mt-3 text-sm text-muted-foreground">
                Motivos: {topReasons.map(([r, n]) => `${CLAIM_REASON_LABELS[r]} (${n})`).join(", ")}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <nav className="inline-flex w-fit rounded-lg bg-muted p-1" aria-label="Reclamos">
        {(
          [
            ["open", "Abiertos"],
            ["all", "Todos"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={`/m/${merchantId}/claims?scope=${value}`}
            aria-current={scope === value ? "page" : undefined}
            className={cn("rounded-md px-3 py-1 text-sm font-medium", scope === value ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {label}
          </Link>
        ))}
      </nav>
      {list.length === 0 && <p className="text-sm text-muted-foreground">{scope === "open" ? "No hay reclamos abiertos." : "Todavía no hubo reclamos."}</p>}
      <div className="grid gap-3">
        {list.map((c) => (
          <Link key={c.id} href={`/m/${merchantId}/claims/${c.id}`}>
            <Card className="hover:bg-muted/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
                <div className="grid gap-0.5">
                  <span className="font-medium">
                    <span className="font-mono">{c.orderCode}</span> · {CLAIM_REASON_LABELS[c.reason]}
                  </span>
                  <span className="text-muted-foreground line-clamp-1">{c.description}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {c.sensitive && <Badge variant="destructive">Salud o seguridad</Badge>}
                  <Badge variant={c.status === "OPEN" ? "default" : "outline"}>{CLAIM_STATUS_LABELS[c.status]}</Badge>
                  {c.status === "OPEN" && <span className="text-xs text-muted-foreground">Respondé antes de {formatDateTime(c.merchantDueAt)}</span>}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}
