import type { SettlementStatus } from "@pedilo/api-client";
import { formatARS, SETTLEMENT_STATUS_LABELS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { SettlementBadge } from "@/components/settlement-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminCall } from "@/lib/api";
import { cn } from "@/lib/utils";

import { CloseWeekButton } from "./close-week-button";

const TABS: Array<SettlementStatus | "ALL"> = ["ALL", "OVERDUE", "PENDING", "PARTIALLY_PAID", "PAID"];

export default function SettlementsPage({ searchParams }: PageProps<"/settlements">) {
  return (
    <>
      <PageHeader
        title="Liquidaciones"
        description="Comisiones semanales de cada comercio. Se cierran solas los lunes 00:00; vencidas primero."
        actions={<CloseWeekButton />}
      />
      <Suspense fallback={<TableSkeleton />}>
        <SettlementsSection searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function SettlementsSection({ searchParams }: { searchParams: PageProps<"/settlements">["searchParams"] }) {
  const raw = (await searchParams).status;
  const status = TABS.includes(raw as SettlementStatus) ? (raw as SettlementStatus) : "ALL";
  const list = await adminCall((api) =>
    api.GET("/v1/admin/settlements", { params: { query: status === "ALL" ? {} : { status } } }),
  );
  const outstanding = list.reduce((n, s) => n + s.outstandingMinor, 0);

  return (
    <div className="grid gap-4">
      <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 sm:w-fit" aria-label="Estado">
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={tab === "ALL" ? "/settlements" : `/settlements?status=${tab}`}
            aria-current={tab === status ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              tab === status ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "ALL" ? "Todas" : SETTLEMENT_STATUS_LABELS[tab]}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">
        {list.length} liquidaciones · pendiente de cobro {formatARS(outstanding)}
      </p>
      <Card>
        <CardContent>
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay liquidaciones.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Comercio</TableHead>
                  <TableHead>Corte</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/settlements/${s.id}`} className="font-medium underline-offset-2 hover:underline">
                        {s.merchant.name}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDateTime(s.periodEnd)}</TableCell>
                    <TableCell>{formatDateTime(s.dueAt)}</TableCell>
                    <TableCell>
                      <SettlementBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatARS(s.totalMinor)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatARS(s.outstandingMinor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
