import type { ClaimStatus } from "@pedilo/domain";
import { CLAIM_REASON_LABELS, CLAIM_STATUS_LABELS } from "@pedilo/domain";
import { formatARS } from "@pedilo/domain";
import { formatDateTime, formatMinutes } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminCall } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS: Array<ClaimStatus | "ALL"> = ["ESCALATED", "OPEN", "DISPUTED", "AGREED_REFUND", "RESOLVED", "ALL"];

export default function ClaimsPage({ searchParams }: PageProps<"/claims">) {
  return (
    <>
      <PageHeader title="Reclamos" description="Pedilo interviene en los escalados: sin respuesta del comercio, en desacuerdo o de salud y seguridad." />
      <Suspense fallback={<TableSkeleton />}>
        <ClaimsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ClaimsSection({ searchParams }: { searchParams: PageProps<"/claims">["searchParams"] }) {
  const raw = (await searchParams).status;
  const status = TABS.includes(raw as ClaimStatus) ? (raw as ClaimStatus | "ALL") : "ESCALATED";
  const [list, metrics] = await Promise.all([
    adminCall((api) => api.GET("/v1/admin/claims", { params: { query: status === "ALL" ? {} : { status } } })),
    adminCall((api) => api.GET("/v1/admin/claims/metrics", { params: { query: { days: 30 } } })),
  ]);
  const withClaims = metrics.filter((m) => m.claims > 0);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Comercios, últimos 30 días</CardTitle>
          <CardDescription>Mayor tasa de reclamos primero. «Sin respuesta» son los que el comercio dejó vencer.</CardDescription>
        </CardHeader>
        <CardContent>
          {withClaims.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ningún comercio tuvo reclamos en el período.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comercio</TableHead>
                  <TableHead className="text-right">Reclamos</TableHead>
                  <TableHead className="text-right">Cada 100 pedidos</TableHead>
                  <TableHead className="text-right">Abiertos</TableHead>
                  <TableHead className="text-right">Sin respuesta</TableHead>
                  <TableHead className="text-right">A la propuesta</TableHead>
                  <TableHead className="text-right">Devuelto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withClaims.map((m) => (
                  <TableRow key={m.merchant.id}>
                    <TableCell>
                      <Link href={`/merchants/${m.merchant.id}`} className="font-medium underline-offset-2 hover:underline">
                        {m.merchant.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.claims} / {m.completedOrders}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.claimRatePer100 ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.open}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", m.slaMissed > 0 && "font-semibold text-destructive")}>{m.slaMissed}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMinutes(m.medianMinutesToProposal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatARS(m.refundedMinor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:w-fit" aria-label="Estado">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={`/claims?status=${tab}`}
            aria-current={tab === status ? "page" : undefined}
            className={cn("rounded-md px-3 py-1 text-sm font-medium", tab === status ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {tab === "ALL" ? "Todos" : CLAIM_STATUS_LABELS[tab]}
          </Link>
        ))}
      </nav>
      {list.length === 0 && <p className="text-sm text-muted-foreground">No hay reclamos en este estado.</p>}
      {list.map((c) => (
        <Link key={c.id} href={`/claims/${c.id}`}>
          <Card className="hover:bg-muted/40">
            <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {c.merchant.name} · <span className="font-mono">{c.orderCode}</span> · {CLAIM_REASON_LABELS[c.reason]}
                </span>
                <span className="line-clamp-1 text-muted-foreground">{c.description}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {c.sensitive && <Badge variant="destructive">Salud o seguridad</Badge>}
                <Badge variant="outline">{CLAIM_STATUS_LABELS[c.status]}</Badge>
                <span className="text-xs text-muted-foreground">{formatDateTime(c.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
