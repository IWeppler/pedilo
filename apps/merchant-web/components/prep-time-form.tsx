"use client";

import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

/**
 * Tiempo de preparación de un pedido típico (ADR 0029). Con esto la app le muestra al cliente
 * cuánto va a tardar («25–35 min» con envío) y puede ordenar por «Más rápidos».
 */
export function PrepTimeForm({
  action,
  prepMinutes,
  disabled,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  prepMinutes: number | null;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.saved && !state.message && <p className="text-sm text-emerald-700">Tiempo de preparación guardado.</p>}

      <FormField
        id="prepMinutes"
        label="Minutos para preparar un pedido"
        error={err.prepMinutes}
        hint="Un pedido normal, desde que lo aceptás hasta que está listo. Entre 5 y 120. Vacío = no se muestra el tiempo en la app."
      >
        <div className="flex items-center gap-2">
          <Input
            {...fieldA11y("prepMinutes", err.prepMinutes, true)}
            type="number"
            min={5}
            max={120}
            step={5}
            defaultValue={v?.prepMinutes ?? (prepMinutes != null ? String(prepMinutes) : "")}
            disabled={disabled}
            className="w-28"
            placeholder="25"
          />
          <span className="text-sm text-muted-foreground">minutos</span>
        </div>
      </FormField>

      <div>
        {!disabled && <SubmitButton>Guardar</SubmitButton>}
      </div>
    </form>
  );
}
