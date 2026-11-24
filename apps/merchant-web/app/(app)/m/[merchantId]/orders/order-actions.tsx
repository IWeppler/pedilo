"use client";

import type { OrderStatus } from "@pedilo/api-client";
import type { MerchantOrderAction } from "@pedilo/domain";
import { initialFormState } from "@pedilo/web-utils";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { transitionOrder } from "./actions";

/** Botones de acción de un pedido. Rechazar/cancelar piden motivo antes de confirmar. */
export function OrderActions({
  merchantId,
  orderId,
  actions,
}: {
  merchantId: string;
  orderId: string;
  actions: MerchantOrderAction[];
}) {
  const [withReason, setWithReason] = useState<MerchantOrderAction | null>(null);
  if (actions.length === 0) return null;

  return (
    <div className="grid gap-2">
      {withReason ? (
        <ActionForm
          merchantId={merchantId}
          orderId={orderId}
          action={withReason}
          onCancel={() => setWithReason(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) =>
            a.needsReason ? (
              <Button key={a.to} type="button" variant="outline" size="sm" onClick={() => setWithReason(a)}>
                {a.label}…
              </Button>
            ) : (
              <ActionForm key={a.to} merchantId={merchantId} orderId={orderId} action={a} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ActionForm({
  merchantId,
  orderId,
  action,
  onCancel,
}: {
  merchantId: string;
  orderId: string;
  action: MerchantOrderAction;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    transitionOrder.bind(null, merchantId, orderId, action.to as OrderStatus),
    initialFormState,
  );
  const error = state.fieldErrors?.reason ?? state.message;

  return (
    <form action={formAction} className="grid gap-1.5">
      {action.needsReason ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            name="reason"
            aria-label={`Motivo para «${action.label}» (lo ve el cliente)`}
            placeholder="Motivo (lo ve el cliente)"
            required
            maxLength={300}
            autoFocus
            className="w-72"
          />
          <Button type="submit" variant="destructive" size="sm" disabled={pending}>
            {pending ? "Enviando…" : `Confirmar: ${action.label.toLowerCase()}`}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Volver
          </Button>
        </div>
      ) : (
        <Button type="submit" size="sm" variant={action.tone === "primary" ? "default" : "outline"} disabled={pending}>
          {pending ? "…" : action.label}
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
