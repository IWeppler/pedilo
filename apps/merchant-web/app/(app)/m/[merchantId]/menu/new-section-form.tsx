"use client";

import { formKey, initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";

import { createSection } from "./actions";

/** Alta rápida de sección desde el listado del catálogo. */
export function NewSectionForm({ merchantId }: { merchantId: string }) {
  const [state, action] = useActionState(createSection.bind(null, merchantId), initialFormState);
  const error = state.fieldErrors?.name ?? (state.saved ? undefined : state.message);
  return (
    // Tras guardar, React 19 vacía el form solo; tras un error se remonta con lo tipeado.
    <form key={formKey(state.values)} action={action} className="grid gap-1">
      <div className="flex flex-wrap gap-2">
        <Input
          name="name"
          aria-label="Nombre de la nueva sección"
          defaultValue={state.values?.name ?? ""}
          placeholder="Nueva sección (p. ej. Empanadas)"
          required
          minLength={2}
          maxLength={80}
          className="w-64"
        />
        <SubmitButton pendingText="Agregando…">Agregar sección</SubmitButton>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
