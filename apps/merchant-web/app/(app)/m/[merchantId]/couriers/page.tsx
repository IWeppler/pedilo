import { formatARS, VEHICLE_LABELS } from "@pedilo/domain";
import { formatDateTime } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";

import { PaymentForm } from "./payment-form";

type Props = PageProps<"/m/[merchantId]/couriers">;

export default function CouriersPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <Couriers params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Cuentas con los repartidores de Pedilo (ADR 0016): lo que el comercio les debe por envíos y lo
 * que ellos le deben por efectivo cobrado. Pedilo registra; los pagos se hacen por fuera.
 */
async function Couriers({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const balances = await merchantCall(
    (api) => api.GET("/v1/merchants/{merchantId}/courier-balances", { params: { path: { merchantId } } }),
    { notFoundOn404: true },
  );
  const selectedId = typeof query.courier === "string" ? query.courier : balances[0]?.courier.id;
  const account = selectedId
    ? await merchantCall((api) =>
        api.GET("/v1/merchants/{merchantId}/courier-balances/{courierId}", { params: { path: { merchantId, courierId: selectedId } } }),
      ).catch(() => null)
    : null;

  return (
    <>
      <PageHeader
        title="Repartidores"
        description="Lo que les debés por envíos y lo que te deben por efectivo cobrado a clientes."
      />

      {balances.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no trabajaste con repartidores de Pedilo.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
          <Card>
            <CardContent className="grid gap-1 pt-4">
              {balances.map((b) => (
                <Link
                  key={b.courier.id}
                  href={`/m/${merchantId}/couriers?courier=${b.courier.id}`}
                  aria-current={b.courier.id === selectedId ? "page" : undefined}
                  className="grid gap-0.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted aria-[current=page]:bg-muted"
                >
                  <span className="font-medium">{b.courier.name}</span>
                  <span className={b.balanceMinor > 0 ? "text-amber-700" : b.balanceMinor < 0 ? "text-emerald-700" : "text-muted-foreground"}>
                    {b.balanceMinor > 0 ? `Le debés ${formatARS(b.balanceMinor)}` : b.balanceMinor < 0 ? `Te debe ${formatARS(-b.balanceMinor)}` : "Al día"}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>

          {account && (
            <Card>
              <CardHeader>
                <CardTitle>{account.courier.name}</CardTitle>
                <CardDescription>
                  {VEHICLE_LABELS[account.courier.vehicle]} ·{" "}
                  <a href={`tel:${account.courier.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">
                    {account.courier.phone}
                  </a>
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-lg font-semibold">
                  {account.balanceMinor > 0
                    ? `Le debés ${formatARS(account.balanceMinor)}`
                    : account.balanceMinor < 0
                      ? `Te debe ${formatARS(-account.balanceMinor)}`
                      : "Están al día"}
                </p>
                <PaymentForm merchantId={merchantId} courierId={account.courier.id} balanceMinor={account.balanceMinor} />
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Fecha</th>
                      <th className="py-2 pr-3 font-medium">Concepto</th>
                      <th className="py-2 text-right font-medium">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-0">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                        <td className="py-1.5 pr-3">{e.description}</td>
                        <td className="py-1.5 text-right tabular-nums">{formatARS(e.amountMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground">
                  Positivo: suma a lo que le debés. Negativo: efectivo que cobró o pagos que le hiciste. Los movimientos no se editan.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
