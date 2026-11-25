"use client";

import { initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { confirmPayment } from "./actions";

/**
 * «Ya cobré» / «Llegó la transferencia» (SPEC §8.3). Nunca automático: el comprobante que mande el
 * cliente no prueba el pago, hay que verlo en la cuenta.
 */
export function PaymentConfirm({
  merchantId,
  orderId,
  method,
}: {
  merchantId: string;
  orderId: string;
  method: "CASH" | "TRANSFER";
}) {
  const [state, formAction, pending] = useActionState(confirmPayment.bind(null, merchantId, orderId), initialFormState);
  return (
    <form action={formAction} className="grid gap-1">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "…" : method === "TRANSFER" ? "Me llegó la transferencia" : "Ya cobré"}
      </Button>
      {state.message && <p className="text-xs text-destructive">{state.message}</p>}
    </form>
  );
}
