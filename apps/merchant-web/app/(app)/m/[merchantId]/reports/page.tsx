import { formatARS } from "@pedilo/domain";
import Link from "next/link";
import { Suspense } from "react";

import {
  CumulativeNetChart,
  DailyNetChart,
} from "@/components/earnings-charts";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { merchantCall } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = PageProps<"/m/[merchantId]/reports">;

const RANGES = [7, 30, 90] as const;
const PAYMENT_LABELS = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  MERCADO_PAGO: "Mercado Pago",
} as const;

export default function ReportsPage({ params, searchParams }: Props) {
  return (
    <>
      <PageHeader title="Reportes" />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <Reports params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/**
 * Ganancias del comercio: ventas de pedidos completados menos comisión Pedilo y devoluciones,
 * día por día y acumuladas en el período elegido (7, 30 o 90 días, terminando hoy).
 */
async function Reports({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const days = RANGES.find((r) => String(r) === query.days) ?? 30;
  const report = await merchantCall(
    (api) =>
      api.GET("/v1/merchants/{merchantId}/reports/earnings", {
        params: { path: { merchantId }, query: { days } },
      }),
    { notFoundOn404: true },
  );
  const { totals, previous } = report;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {formatDay(report.from)} al {formatDay(report.to)}. Ventas de pedidos
          entregados o retirados, menos la comisión de Pedilo y lo devuelto en
          reclamos.
        </p>
        <nav
          className="inline-flex w-fit rounded-lg bg-muted p-1"
          aria-label="Período"
        >
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/m/${merchantId}/reports?days=${r}`}
              aria-current={days === r ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium",
                days === r
                  ? "bg-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r} días
            </Link>
          ))}
        </nav>
      </div>

      {/* La cifra que importa primero; el resto, al costado. */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_2fr]">
        <Card>
          <CardHeader>
            <CardDescription>Ganancia neta</CardDescription>
            <p className="text-5xl font-semibold tracking-tight tabular-nums">
              {formatARS(totals.netMinor)}
            </p>
            <Delta
              current={totals.netMinor}
              previous={previous.netMinor}
              days={days}
            />
          </CardHeader>
        </Card>
        <div className="grid grid-cols-2 gap-4">
          <Stat
            label="Ventas"
            value={formatARS(totals.salesMinor)}
            hint={`Incluye ${formatARS(totals.deliveryFeesMinor)} de envíos`}
          />
          <Stat
            label="Comisión Pedilo"
            value={formatARS(totals.commissionMinor)}
            hint="Se paga en la liquidación semanal"
          />
          <Stat
            label="Pedidos completados"
            value={String(totals.orders)}
            hint={
              totals.averageTicketMinor !== null
                ? `Ticket promedio ${formatARS(totals.averageTicketMinor)}`
                : "Sin pedidos en el período"
            }
          />
          <Stat
            label="Devoluciones"
            value={formatARS(totals.refundsMinor)}
            hint="Acordadas en reclamos"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ganancia neta por día</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyNetChart days={report.days} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ganancia acumulada</CardTitle>
          <CardDescription>
            Suma de la ganancia neta desde el {formatDay(report.from)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CumulativeNetChart days={report.days} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Ventas por medio de pago</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm">
              {(
                Object.keys(PAYMENT_LABELS) as (keyof typeof PAYMENT_LABELS)[]
              ).map((k) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{PAYMENT_LABELS[k]}</dt>
                  <dd className="font-medium tabular-nums">
                    {formatARS(report.salesByPaymentMethod[k])}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Detalle por día</CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Ver la tabla
              </summary>
              <div className="mt-3 max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background text-left text-muted-foreground">
                    <tr>
                      <th className="py-1.5 font-medium">Día</th>
                      <th className="py-1.5 text-right font-medium">Pedidos</th>
                      <th className="py-1.5 text-right font-medium">Ventas</th>
                      <th className="py-1.5 text-right font-medium">
                        Comisión
                      </th>
                      <th className="py-1.5 text-right font-medium">Neto</th>
                      <th className="py-1.5 text-right font-medium">
                        Acumulado
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {[...report.days].reverse().map((d) => (
                      <tr key={d.date} className="border-t">
                        <td className="py-1.5">{formatDay(d.date, true)}</td>
                        <td className="py-1.5 text-right">{d.orders}</td>
                        <td className="py-1.5 text-right">
                          {formatARS(d.salesMinor)}
                        </td>
                        <td className="py-1.5 text-right">
                          {formatARS(d.commissionMinor)}
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          {formatARS(d.netMinor)}
                        </td>
                        <td className="py-1.5 text-right">
                          {formatARS(d.cumulativeNetMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
    </Card>
  );
}

/** Variación contra el período anterior de igual duración. */
function Delta({
  current,
  previous,
  days,
}: {
  current: number;
  previous: number;
  days: number;
}) {
  if (previous === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin datos de los {days} días anteriores para comparar.
      </p>
    );
  }
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  const up = pct >= 0;
  return (
    <p className="text-sm text-muted-foreground">
      <span
        className={cn("font-medium", up ? "text-emerald-700" : "text-red-700")}
      >
        {up ? "▲" : "▼"} {Math.abs(pct)}%
      </span>{" "}
      contra los {days} días anteriores ({formatARS(previous)})
    </p>
  );
}

function formatDay(date: string, withWeekday = false) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("es-AR", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(withWeekday && { weekday: "short" }),
  });
}
