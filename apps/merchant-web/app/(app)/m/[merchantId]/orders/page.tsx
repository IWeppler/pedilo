import type { MerchantOrder as Order } from "@pedilo/api-client";
import {
  formatARS,
  isOrderFinal,
  merchantOrderActions,
  ORDER_STATUS_LABELS,
} from "@pedilo/domain";
import { formatDateTime, formatSlot } from "@pedilo/web-utils";
import Link from "next/link";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/table-skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { merchantCall } from "@/lib/api";
import { cn } from "@/lib/utils";

import { Deadline } from "./deadline";
import { DispatchPanel } from "./dispatch";
import { Elapsed } from "./elapsed";
import { OrderActions } from "./order-actions";
import { PaymentConfirm } from "./payment-confirm";

type Props = PageProps<"/m/[merchantId]/orders">;

export default function OrdersPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <Orders params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const [{ merchantId }, query] = await Promise.all([params, searchParams]);
  const scope = query.scope === "done" ? "done" : "active";
  const orders = await merchantCall(
    (api) =>
      api.GET("/v1/merchants/{merchantId}/orders", {
        params: { path: { merchantId }, query: { scope } },
      }),
    { notFoundOn404: true },
  );
  // Los nuevos (sin aceptar) arriba; el resto, del más antiguo al más nuevo.
  const sorted =
    scope === "active"
      ? [
          ...orders.filter((o) => o.status === "PLACED"),
          ...orders.filter((o) => o.status !== "PLACED"),
        ]
      : orders;

  return (
    <>
      <PageHeader title="Pedidos" />
      <nav
        className="inline-flex w-fit rounded-lg bg-muted p-1"
        aria-label="Pedidos"
      >
        {(
          [
            [
              "active",
              `En curso${orders.length && scope === "active" ? ` (${orders.length})` : ""}`,
            ],
            ["done", "Finalizados"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={`/m/${merchantId}/orders?scope=${value}`}
            aria-current={scope === value ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium",
              scope === value
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {scope === "active"
            ? "No hay pedidos en curso."
            : "Todavía no hay pedidos finalizados."}
        </p>
      )}

      <div className="grid gap-4">
        {sorted.map((order) => (
          <OrderCard key={order.id} order={order} merchantId={merchantId} />
        ))}
      </div>
    </>
  );
}

const BY_COURIER: string[] = [
  "PICKED_UP_BY_COURIER",
  "DELIVERED",
  "DELIVERY_FAILED",
];

const PAYMENT_LABELS: Record<Order["paymentMethod"], string> = {
  CASH: "Efectivo",
  TRANSFER: "Transferencia",
  MERCADO_PAGO: "Mercado Pago",
};

function paymentStatusLabel(o: Order): string {
  if (o.paymentStatus === "APPROVED")
    return o.paymentMethod === "TRANSFER" ? "recibida" : "cobrado";
  if (o.paymentStatus === "CANCELLED") return "sin cobrar";
  if (o.paymentStatus === "PENDING")
    return o.paymentMethod === "TRANSFER" ? "a confirmar" : "a cobrar";
  return o.paymentStatus.toLowerCase();
}

function OrderCard({
  order: o,
  merchantId,
}: {
  order: Order;
  merchantId: string;
}) {
  const isNew = o.status === "PLACED";
  const final = isOrderFinal(o.status);

  return (
    <Card className={cn(isNew && "ring-2 ring-primary")}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{o.code}</span>
            <Badge
              variant={isNew ? "default" : final ? "outline" : "secondary"}
            >
              {ORDER_STATUS_LABELS[o.status]}
            </Badge>
            <Badge variant="outline">
              {o.fulfillmentType === "PICKUP" ? "Retiro" : "Envío"}
            </Badge>
            {o.scheduledFor && (
              <Badge variant="secondary">
                Programado · {formatSlot(o.scheduledFor)}
              </Badge>
            )}
            {isNew && !o.acknowledgedAt && (
              <Badge variant="destructive">Sin ver</Badge>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {final ? (
              formatDateTime(o.updatedAt)
            ) : (
              <Elapsed since={o.createdAt} />
            )}
            {isNew && (
              <>
                {" "}
                · <Deadline at={o.acceptDeadlineAt} />
              </>
            )}{" "}
            · {o.customer.name} ·{" "}
            <a
              href={`tel:${o.customer.phone.replace(/[^\d+]/g, "")}`}
              className="underline underline-offset-2"
            >
              {o.customer.phone}
            </a>
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums">
            {formatARS(o.totalMinor)}
          </p>
          <p className="text-xs text-muted-foreground">
            {PAYMENT_LABELS[o.paymentMethod]} · {paymentStatusLabel(o)}
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {o.delivery && (
          <p>
            <span className="text-muted-foreground">Entregar en: </span>
            {o.delivery.addressLine}
            {o.delivery.addressNotes && ` (${o.delivery.addressNotes})`} · zona{" "}
            {o.delivery.zoneName}
          </p>
        )}
        <ul className="grid gap-1.5">
          {o.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3">
              <div>
                <span className="font-medium">
                  {item.quantity} × {item.productName}
                  {item.variantName && ` (${item.variantName})`}
                </span>
                {item.options.length > 0 && (
                  <span className="block text-muted-foreground">
                    {item.options
                      .map(
                        (op) =>
                          `${op.quantity > 1 ? `${op.quantity}× ` : ""}${op.name}`,
                      )
                      .join(", ")}
                  </span>
                )}
                {item.notes && (
                  <span className="block text-muted-foreground italic">
                    «{item.notes}»
                  </span>
                )}
              </div>
              <span className="tabular-nums">{formatARS(item.totalMinor)}</span>
            </li>
          ))}
        </ul>
        {o.notes && (
          <p className="italic text-muted-foreground">
            Nota del cliente: «{o.notes}»
          </p>
        )}
        {o.deliveryFeeMinor > 0 && (
          <p className="text-muted-foreground">
            Subtotal {formatARS(o.subtotalMinor)} + envío{" "}
            {formatARS(o.deliveryFeeMinor)}
          </p>
        )}
        {o.transfer && o.paymentStatus === "PENDING" && (
          <p className="text-muted-foreground">
            Transferencia a {o.transfer.alias ?? o.transfer.cbu} (
            {o.transfer.holder}). Confirmala recién cuando la veas en tu cuenta.
          </p>
        )}
        {o.commission && (
          <p className="text-xs text-muted-foreground">
            Comisión Pedilo {formatARS(o.commission.amountMinor)}
            {o.commission.capApplied && " (tope del rubro)"} · se suma al
            completar el pedido
          </p>
        )}
        {o.statusReason && final && (
          <p className="text-muted-foreground">Motivo: {o.statusReason}</p>
        )}
        {!final && <DispatchPanel merchantId={merchantId} order={o} />}
        <div className="flex flex-wrap items-start gap-2">
          <OrderActions
            merchantId={merchantId}
            orderId={o.id}
            // Con repartidor de Pedilo, salida y entrega las marca su app (ADR 0014).
            actions={merchantOrderActions(o.status, o.fulfillmentType).filter(
              (a) => !o.dispatch || !BY_COURIER.includes(a.to),
            )}
          />
          {o.paymentStatus === "PENDING" &&
            o.paymentMethod !== "MERCADO_PAGO" &&
            (o.paymentMethod === "TRANSFER" || !final) && (
              <PaymentConfirm
                merchantId={merchantId}
                orderId={o.id}
                method={o.paymentMethod}
              />
            )}
        </div>
      </CardContent>
    </Card>
  );
}
