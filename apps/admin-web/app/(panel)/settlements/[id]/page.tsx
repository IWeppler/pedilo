import { ApiError } from "@pedilo/api-client";
import { formatARS } from "@pedilo/domain";
import { COMMISSION_ENTRY_LABELS, formatDateTime, SETTLEMENT_PAYMENT_METHOD_LABELS } from "@pedilo/web-utils";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { SettlementBadge } from "@/components/settlement-badge";
import { TableSkeleton } from "@/components/table-skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminCall } from "@/lib/api";

import { PaymentForm } from "./payment-form";

export default function SettlementPage({ params }: PageProps<"/settlements/[id]">) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <SettlementDetail params={params} />
    </Suspense>
  );
}

async function SettlementDetail({ params }: { params: PageProps<"/settlements/[id]">["params"] }) {
  const { id } = await params;
  const s = await adminCall((api) => api.GET("/v1/admin/settlements/{settlementId}", { params: { path: { settlementId: id } } })).catch(
    (err: unknown) => {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
      throw err;
    },
  );

  return (
    <>
      <PageHeader
        title={`Liquidación de ${s.merchant.name}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <SettlementBadge status={s.status} />
            <span>
              Corte {formatDateTime(s.periodEnd)} · vence {formatDateTime(s.dueAt)}
            </span>
          </span>
        }
        actions={
          <>
            <Link href={`/merchants/${s.merchant.id}`} className={buttonVariants({ variant: "outline" })}>
              Ver comercio
            </Link>
            <Link href="/settlements" className={buttonVariants({ variant: "outline" })}>
              Volver
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total" value={formatARS(s.totalMinor)} />
        <Stat label="Pagado" value={formatARS(s.paidMinor)} />
        <Stat label="Pendiente" value={formatARS(s.outstandingMinor)} />
      </div>

      {s.outstandingMinor > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Registrar pago</CardTitle>
            <CardDescription>Parcial o total. Los pagos no se editan: verificá el monto antes de registrar.</CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentForm settlementId={s.id} outstandingMinor={s.outstandingMinor} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pagos</CardTitle>
        </CardHeader>
        <CardContent>
          {s.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin pagos todavía.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos incluidos ({s.entryCount})</CardTitle>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="grid gap-1 pt-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
      </CardContent>
    </Card>
  );
}
