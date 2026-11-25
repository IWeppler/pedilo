"use client";

import type { BranchScheduling } from "@pedilo/api-client";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import { useActionState, useState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

/** Pedidos programados de una sucursal (ADR 0011): anticipación, días y cupo por franja. */
export function SchedulingForm({
  action,
  scheduling,
  disabled,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  scheduling: BranchScheduling;
  disabled?: boolean;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  const [enabled, setEnabled] = useState(v ? v.enabled === "on" : scheduling.enabled);
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.saved && !state.message && <p className="text-sm text-emerald-700">Programación guardada.</p>}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={disabled}
          className="size-4 accent-primary"
        />
        Aceptar pedidos programados
      </label>

      {enabled && (
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="leadMinutes" label="Anticipación mínima (min)" error={err["scheduling.leadMinutes"]} hint="Entre 15 y 2880.">
            <Input
              {...fieldA11y("leadMinutes", err["scheduling.leadMinutes"], true)}
              type="number"
              min={15}
              max={2880}
              step={15}
              defaultValue={value("leadMinutes", String(scheduling.leadMinutes))}
              disabled={disabled}
              required
            />
          </FormField>
          <FormField id="maxDays" label="Días hacia adelante" error={err["scheduling.maxDays"]} hint="Entre 1 y 14.">
            <Input
              {...fieldA11y("maxDays", err["scheduling.maxDays"], true)}
              type="number"
              min={1}
              max={14}
              defaultValue={value("maxDays", String(scheduling.maxDays))}
              disabled={disabled}
              required
            />
          </FormField>
          <FormField id="slotCapacity" label="Pedidos por franja" error={err["scheduling.slotCapacity"]} hint="Vacío = sin límite.">
            <Input
              {...fieldA11y("slotCapacity", err["scheduling.slotCapacity"], true)}
              type="number"
              min={1}
              max={500}
              defaultValue={value("slotCapacity", scheduling.slotCapacity === null ? "" : String(scheduling.slotCapacity))}
              disabled={disabled}
            />
          </FormField>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        El cliente elige una franja de 30 minutos dentro del horario de la sucursal, aunque ahora esté cerrada. Tenés hasta
        30 minutos antes de la franja para aceptarlo.
      </p>

      {!disabled && (
        <div>
          <SubmitButton>Guardar programación</SubmitButton>
        </div>
      )}
    </form>
  );
}
