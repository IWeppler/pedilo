import { formatARS, SETTLEMENT_STATUS_LABELS } from "@pedilo/domain";
import { COMMISSION_ENTRY_LABELS, formatBps, formatDateTime, PLAN_LABELS } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { CommissionSimulator } from "@/components/commission-simulator";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";

type Props = PageProps<"/m/[merchantId]/billing">;

export default function BillingPage({ params }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <Billing params={params} />
    </Suspense>
  );
}

/** Plan, comisiones y estado de cuenta del comercio (SPEC §6, ADR 0012). */
async function Billing({ params }: { params: Props["params"] }) {
  const { merchantId } = await params;
  const b = await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/billing", { params: { path: { merchantId } } }),
    { notFoundOn404: true },
  );

  return (
    <>
      <PageHeader
        title="Plan y comisiones"
        description="Pedilo cobra una comisión por pedido completado. El cliente no paga cargos de Pedilo."
        actions={
          <Link href={`/m/${merchantId}`} className={buttonVariants({ variant: "outline" })}>
            Volver
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plan {PLAN_LABELS[b.plan.code]}</CardTitle>
            <CardDescription>{b.plan.since ? `Desde ${formatDateTime(b.plan.since)}` : "Plan inicial"}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Item label="Comisión base">{formatBps(b.plan.baseRateBps)}</Item>
              <Item label="Mensualidad">{formatARS(b.plan.monthlyFeeMinor)}</Item>
              <Item label="Tope por pedido">{formatARS(b.capMinor)}</Item>
              <Item label="Sucursales / usuarios">
                {b.plan.maxBranches} / {b.plan.maxUsers}
              </Item>
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Para cambiar de plan, escribinos. El cambio rige desde ese momento: los pedidos anteriores no cambian.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Saldo de comisiones</CardTitle>
            <CardDescription>Comisiones de pedidos completados, menos lo que ya pagaste.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{formatARS(b.balanceMinor)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {formatARS(b.unsettledMinor)} de esta semana se liquidan el próximo lunes. Cada liquidación vence a los 7 días
              del corte.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Liquidaciones</CardTitle>
          <CardDescription>Cada lunes se cierran las comisiones de la semana anterior.</CardDescription>
        </CardHeader>
        <CardContent>
          {b.settlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay liquidaciones.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Semana hasta</th>
                  <th className="py-2 pr-3 font-medium">Vence</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="py-2 text-right font-medium">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {b.settlements.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/m/${merchantId}/billing/settlements/${s.id}`} className="underline underline-offset-2">
                        {formatDateTime(s.periodEnd)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{formatDateTime(s.dueAt)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={s.status === "OVERDUE" ? "destructive" : s.status === "PAID" ? "secondary" : "outline"}>
                        {SETTLEMENT_STATUS_LABELS[s.status]}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatARS(s.totalMinor)}</td>
                    <td className="py-2 text-right tabular-nums">{formatARS(s.outstandingMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Simulador</CardTitle>
          <CardDescription>
            Compará cuánto pagarías en cada plan. Precios de lanzamiento a validar (versión {b.pricing.id}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommissionSimulator pricing={b.pricing} category={b.category} currentPlan={b.plan.code} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
          <CardDescription>Últimos 100. Los movimientos no se editan: las correcciones son ajustes.</CardDescription>
        </CardHeader>
        <CardContent>
          {b.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Fecha</th>
                  <th className="py-2 pr-3 font-medium">Concepto</th>
                  <th className="py-2 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {b.entries.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                    <td className="py-2 pr-3">
                      <span className="text-muted-foreground">{COMMISSION_ENTRY_LABELS[e.kind]} · </span>
                      {e.description}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatARS(e.amountMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
