"use client";

import type { MerchantOrder } from "@pedilo/api-client";
import { DELIVERY_STATUS_LABELS, type DeliveryStatus, formatARS, VEHICLE_LABELS, type Vehicle } from "@pedilo/domain";
import { initialFormState, minorToPesosInput } from "@pedilo/web-utils";
import { Bike } from "lucide-react";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { cancelDispatch, reofferDispatch, requestDispatch, resetDispatchPin } from "./actions";
import { useMinutesLeft } from "../order-alerts";

type Dispatch = NonNullable<MerchantOrder["dispatch"]>;

const REQUESTABLE = ["ACCEPTED", "PREPARING", "READY"];
const REOFFERABLE: DeliveryStatus[] = ["OFFERED", "OFFER_EXPIRED", "COURIER_CANCELLED"];
const CANCELLABLE: DeliveryStatus[] = ["OFFERED", "OFFER_EXPIRED", "COURIER_CANCELLED", "ASSIGNED", "ARRIVING_PICKUP", "DELIVERY_NEEDED"];

/**
 * Repartidor de Pedilo para un pedido con envío (ADR 0014): pedirlo con una tarifa, ver quién lo
 * lleva, subir la tarifa si nadie acepta o cancelar la búsqueda para mandarlo por cuenta propia.
 */
export function DispatchPanel({ merchantId, order }: { merchantId: string; order: MerchantOrder }) {
  if (order.fulfillmentType !== "DELIVERY") return null;
  const d = order.dispatch;
  if (!d) {
    if (!REQUESTABLE.includes(order.status)) return null;
    return <RequestForm merchantId={merchantId} orderId={order.id} suggestedMinor={order.deliveryFeeMinor} />;
  }
  return <DispatchStatus merchantId={merchantId} d={d} />;
}

function FeeForm({
  action,
  suggestedMinor,
  label,
  withPinOption,
}: {
  action: (prev: typeof initialFormState, formData: FormData) => Promise<typeof initialFormState>;
  suggestedMinor: number;
  label: string;
  withPinOption?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {withPinOption && (
        <label className="flex items-center gap-1.5 text-sm" title="El cliente ve un PIN en el seguimiento y se lo da al repartidor al recibir">
          <input type="checkbox" name="requirePin" defaultChecked className="size-4 accent-primary" />
          Pedir PIN al entregar
        </label>
      )}
      <label className="flex items-center gap-1.5 text-sm">
        Pago al repartidor $
        <Input name="fee" inputMode="decimal" defaultValue={minorToPesosInput(suggestedMinor)} className="h-8 w-24" aria-label="Pago al repartidor en pesos" />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <Bike aria-hidden /> {pending ? "…" : label}
      </Button>
      {state.message && <p className="w-full text-xs text-destructive">{state.message}</p>}
    </form>
  );
}

function RequestForm({ merchantId, orderId, suggestedMinor }: { merchantId: string; orderId: string; suggestedMinor: number }) {
  return (
    <FeeForm action={requestDispatch.bind(null, merchantId, orderId)} suggestedMinor={suggestedMinor} label="Pedir repartidor" withPinOption />
  );
}

function DispatchStatus({ merchantId, d }: { merchantId: string; d: Dispatch }) {
  const status = d.status as DeliveryStatus;
  const minutes = useMinutesLeft(status === "OFFERED" ? d.offerExpiresAt : null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelDispatch.bind(null, merchantId, d.id), initialFormState);
  const [pinState, pinAction, pinPending] = useActionState(resetDispatchPin.bind(null, merchantId, d.id), initialFormState);

  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Bike className="size-4" aria-hidden />
        <span className="font-medium">{DELIVERY_STATUS_LABELS[status]}</span>
        {status === "OFFERED" && minutes !== null && <span className="text-muted-foreground">· la oferta vence en {minutes} min</span>}
        <span className="text-muted-foreground">· pago {formatARS(d.courierFeeMinor)}</span>
        {d.cashToCollectMinor > 0 && <span className="text-muted-foreground">· cobra {formatARS(d.cashToCollectMinor)} en efectivo</span>}
      </p>
      {d.courier && (
        <p>
          {d.courier.name} ({VEHICLE_LABELS[d.courier.vehicle as Vehicle]}) ·{" "}
          <a href={`tel:${d.courier.phone.replace(/[^\d+]/g, "")}`} className="underline underline-offset-2">
            {d.courier.phone}
          </a>
          {d.courierLocation && (
            <>
              {" · "}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${d.courierLocation.lat},${d.courierLocation.lng}`}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                ver dónde está
              </a>
              <span className="text-muted-foreground"> ({locationAge(d.courierLocation.recordedAt)})</span>
            </>
          )}
        </p>
      )}
      {d.pin && status !== "DELIVERED" && (
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">PIN de entrega:</span>
          <span className="font-mono font-semibold tracking-widest">{d.pin}</span>
          <span className="text-xs text-muted-foreground">(lo tiene el cliente; el repartidor no)</span>
        </p>
      )}
      {d.pinLocked && (
        <form action={pinAction} className="flex flex-wrap items-center gap-2 text-destructive">
          <span>El repartidor erró el PIN demasiadas veces.</span>
          <Button type="submit" size="sm" variant="outline" disabled={pinPending}>
            {pinPending ? "…" : "Desbloquear PIN"}
          </Button>
          {pinState.message && <span className="text-xs">{pinState.message}</span>}
        </form>
      )}
      {d.statusReason && status !== "OFFERED" && <p className="text-muted-foreground">Motivo: {d.statusReason}</p>}

      <div className="flex flex-wrap items-start gap-2">
        {REOFFERABLE.includes(status) && (
          <FeeForm
            action={reofferDispatch.bind(null, merchantId, d.id)}
            suggestedMinor={d.courierFeeMinor}
            label={status === "OFFERED" ? "Subir pago" : "Volver a ofertar"}
          />
        )}
        {CANCELLABLE.includes(status) &&
          (cancelling ? (
            <form action={cancelAction} className="flex flex-wrap items-center gap-2">
              <Input name="reason" required minLength={3} maxLength={300} placeholder="Motivo" className="h-8 w-56" aria-label="Motivo" autoFocus />
              <Button type="submit" size="sm" variant="destructive" disabled={cancelPending}>
                {cancelPending ? "…" : "Cancelar reparto"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(false)}>
                Volver
              </Button>
            </form>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => setCancelling(true)}>
              Lo mando por mi cuenta
            </Button>
          ))}
      </div>
      {cancelState.message && <p className="text-xs text-destructive">{cancelState.message}</p>}
    </div>
  );
}

/** Antigüedad de la ubicación del repartidor (ADR 0022). Se recalcula con cada recarga del tablero. */
function locationAge(recordedAt: string): string {
  const min = Math.round((Date.now() - new Date(recordedAt).getTime()) / 60_000);
  return min < 1 ? "recién" : `hace ${min} min`;
}
