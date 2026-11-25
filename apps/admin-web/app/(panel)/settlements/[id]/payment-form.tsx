"use client";

import { minorToPesosInput, formKey, initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

import { recordPayment } from "../actions";

/** Registrar un pago del comercio. Por defecto, lo que falta pagar. */
export function PaymentForm({ settlementId, outstandingMinor }: { settlementId: string; outstandingMinor: number }) {
  const [state, action] = useActionState(recordPayment.bind(null, settlementId), initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};

  return (
    <form key={formKey(v)} action={action} className="grid max-w-xl gap-3">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.saved && <p className="text-sm text-emerald-700">Pago registrado.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="amount" label="Monto ($)" error={err.amount ?? err.amountMinor}>
          <Input
            {...fieldA11y("amount", err.amount)}
            inputMode="decimal"
            required
            defaultValue={v?.amount ?? minorToPesosInput(outstandingMinor)}
          />
        </FormField>
        <FormField id="method" label="Medio">
          <NativeSelect id="method" name="method" defaultValue={v?.method ?? "TRANSFER"}>
            <option value="TRANSFER">Transferencia</option>
            <option value="CASH">Efectivo</option>
            <option value="OTHER">Otro</option>
          </NativeSelect>
        </FormField>
        <FormField id="paidOn" label="Fecha de pago">
          <Input {...fieldA11y("paidOn")} type="date" defaultValue={v?.paidOn ?? ""} />
        </FormField>
      </div>
      <FormField id="reference" label="Referencia (opcional)" hint="Número de operación o comprobante.">
        <Input {...fieldA11y("reference", undefined, true)} maxLength={120} defaultValue={v?.reference ?? ""} />
      </FormField>
      <div>
        <SubmitButton pendingText="Registrando…">Registrar pago</SubmitButton>
      </div>
    </form>
  );
}
