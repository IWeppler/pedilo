import { formatARS, SETTLEMENT_STATUS_LABELS } from "@pedilo/domain";
import { COMMISSION_ENTRY_LABELS, formatDateTime, SETTLEMENT_PAYMENT_METHOD_LABELS } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";

type Props = PageProps<"/m/[merchantId]/billing/settlements/[settlementId]">;

export default function SettlementPage({ params }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <Settlement params={params} />
    </Suspense>
  );
}

/** Detalle de una liquidación semanal: qué comisiones incluye y qué pagos se registraron. */
async function Settlement({ params }: { params: Props["params"] }) {
  const { merchantId, settlementId } = await params;
  const s = await merchantCall(
    (api) =>
      api.GET("/v1/merchants/{merchantId}/settlements/{settlementId}", { params: { path: { merchantId, settlementId } } }),
    { notFoundOn404: true },
  );

  return (
    <>
      <PageHeader
        title={`Liquidación hasta ${formatDateTime(s.periodEnd)}`}
        description={`${SETTLEMENT_STATUS_LABELS[s.status]} · vence ${formatDateTime(s.dueAt)}`}
        actions={
          <Link href={`/m/${merchantId}/billing`} className={buttonVariants({ variant: "outline" })}>
            Volver
          </Link>
        }
      />

      <Card>
        <CardContent className="grid gap-1 pt-4 text-sm">
          <Row label="Total" value={formatARS(s.totalMinor)} />
          <Row label="Pagado" value={formatARS(s.paidMinor)} />
          <Row label="Pendiente" value={formatARS(s.outstandingMinor)} strong />
          {s.outstandingMinor > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Para pagar, transferí a la cuenta de Pedilo y avisanos el número de operación: lo registramos acá.
            </p>
          )}
        </CardContent>
      </Card>

      {s.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pagos</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1.5 text-sm">
              {s.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3">
                  <span>
                    {formatDateTime(p.paidAt)} · {SETTLEMENT_PAYMENT_METHOD_LABELS[p.method]}
                    {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                  </span>
                  <span className="tabular-nums">{formatARS(p.amountMinor)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Comisiones incluidas ({s.entryCount})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-1.5 text-sm">
            {s.entries.map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span>
                  <span className="text-muted-foreground">
                    {formatDateTime(e.createdAt)} · {COMMISSION_ENTRY_LABELS[e.kind as keyof typeof COMMISSION_ENTRY_LABELS] ?? e.kind} ·{" "}
                  </span>
                  {e.description}
                </span>
                <span className="tabular-nums">{formatARS(e.amountMinor)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}
