"use client";

import { formKey, initialFormState, minorToPesosInput } from "@pedilo/web-utils";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

import { recordCourierPayment } from "./actions";

/** Registrar que le pagaste al repartidor o que te rindió el efectivo. Propone saldar la cuenta. */
export function PaymentForm({ merchantId, courierId, balanceMinor }: { merchantId: string; courierId: string; balanceMinor: number }) {
  const [state, action] = useActionState(recordCourierPayment.bind(null, merchantId, courierId), initialFormState);
  const v = state.values;
  const direction = v?.direction ?? (balanceMinor < 0 ? "FROM_COURIER" : "TO_COURIER");

  return (
    <form key={formKey(v)} action={action} className="grid gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select name="direction" defaultValue={direction} className="h-8 rounded-lg border bg-transparent px-2" aria-label="Tipo de pago">
          <option value="TO_COURIER">Le pagué al repartidor</option>
          <option value="FROM_COURIER">Me rindió el efectivo</option>
        </select>
        <label className="flex items-center gap-1">
          $
          <Input
            name="amount"
            inputMode="decimal"
            required
            className="h-8 w-28"
            aria-label="Monto en pesos"
            defaultValue={v?.amount ?? (balanceMinor !== 0 ? minorToPesosInput(Math.abs(balanceMinor)) : "")}
          />
        </label>
        <Input name="note" maxLength={200} placeholder="Nota (opcional)" className="h-8 w-48" defaultValue={v?.note ?? ""} />
        <SubmitButton pendingText="Registrando…">Registrar</SubmitButton>
      </div>
      {state.message && <p className="text-xs text-destructive">{state.message}</p>}
      {state.saved && <p className="text-xs text-emerald-700">Pago registrado.</p>}
    </form>
  );
}
