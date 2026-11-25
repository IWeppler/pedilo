"use client";

import type { PaymentSettings } from "@pedilo/api-client";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import { useActionState, useState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

/** Medios de pago del comercio y datos para transferir (ADR 0011). */
export function PaymentSettingsForm({
  action,
  payment,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  payment: PaymentSettings;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  const [transfer, setTransfer] = useState(v ? v.acceptsTransfer === "on" : payment.acceptsTransfer);
  const value = (key: string, fallback: string | null | undefined) => v?.[key] ?? fallback ?? "";

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.saved && !state.message && <p className="text-sm text-emerald-700">Medios de pago guardados.</p>}

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="acceptsCash"
            defaultChecked={v ? v.acceptsCash === "on" : payment.acceptsCash}
            className="size-4 accent-primary"
          />
          Efectivo
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="acceptsTransfer"
            checked={transfer}
            onChange={(e) => setTransfer(e.target.checked)}
            className="size-4 accent-primary"
          />
          Transferencia bancaria o billetera virtual
        </label>
      </div>

      {transfer && (
        <div className="grid gap-4 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            El cliente ve estos datos recién después de hacer el pedido. Vos confirmás en el panel cuando te llegue la
            plata: Pedilo nunca lo marca como cobrado solo.
          </p>
          <FormField id="holder" label="Titular de la cuenta" error={err["transfer.holder"]}>
            <Input
              {...fieldA11y("holder", err["transfer.holder"])}
              defaultValue={value("holder", payment.transfer?.holder)}
              maxLength={120}
              required
              placeholder="José Pérez"
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="alias" label="Alias" error={err["transfer.alias"]} hint="Alias o CBU/CVU: al menos uno.">
              <Input
                {...fieldA11y("alias", err["transfer.alias"], true)}
                defaultValue={value("alias", payment.transfer?.alias)}
                maxLength={40}
                placeholder="don.pepe.mp"
              />
            </FormField>
            <FormField id="cbu" label="CBU o CVU" error={err["transfer.cbu"]}>
              <Input
                {...fieldA11y("cbu", err["transfer.cbu"])}
                defaultValue={value("cbu", payment.transfer?.cbu)}
                inputMode="numeric"
                maxLength={30}
                placeholder="22 dígitos"
              />
            </FormField>
          </div>
        </div>
      )}

      <div>
        <SubmitButton>Guardar medios de pago</SubmitButton>
      </div>
    </form>
  );
}
