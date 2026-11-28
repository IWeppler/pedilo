"use client";

import type { Branch, City } from "@pedilo/api-client";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { LocationFields } from "@/components/location-fields";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

/**
 * Dirección, teléfono del local, formas de entrega y si recibe pedidos. Por detrás es la única
 * sucursal del comercio: su nombre es el del comercio y viaja oculto (queda en los pedidos).
 */
export function LocationForm({
  action,
  cities,
  merchantName,
  branch,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  cities: City[];
  merchantName: string;
  branch?: Branch;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;
  const checked = (key: string, fallback: boolean) => (v ? v[key] === "on" : fallback);

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.saved && (
        <Alert>
          <AlertDescription>Datos del local guardados.</AlertDescription>
        </Alert>
      )}
      {err.name && (
        <Alert variant="destructive">
          <AlertDescription>El nombre del comercio no es válido: {err.name}</AlertDescription>
        </Alert>
      )}

      <input type="hidden" name="name" value={merchantName} />

      <LocationFields cities={cities} branch={branch} values={v} errors={err} />

      <FormField id="phone" label="Teléfono del local (opcional)" error={err.phone} hint="Si es distinto del de contacto.">
        <Input {...fieldA11y("phone", err.phone)} type="tel" defaultValue={value("phone", branch?.phone ?? "")} maxLength={30} />
      </FormField>

      {branch && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={checked("active", branch.active)} className="mt-0.5 size-4 accent-primary" />
          <span>
            Recibir pedidos
            <span className="block text-muted-foreground">
              Si lo desactivás, el comercio deja de tomar pedidos hasta que lo vuelvas a activar.
            </span>
          </span>
        </label>
      )}

      <div>
        <SubmitButton>{branch ? "Guardar" : "Guardar y seguir"}</SubmitButton>
      </div>
    </form>
  );
}
