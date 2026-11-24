"use client";

import type { Branch, City } from "@pedilo/api-client";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import Link from "next/link";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function BranchForm({
  action,
  cities,
  branch,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  cities: City[];
  branch?: Branch;
  cancelHref?: string;
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
          <AlertDescription>Sucursal guardada.</AlertDescription>
        </Alert>
      )}

      <FormField id="name" label="Nombre de la sucursal" error={err.name} hint="Por ejemplo «Centro» o el nombre del comercio si tenés una sola.">
        <Input {...fieldA11y("name", err.name, true)} defaultValue={value("name", branch?.name ?? "")} required minLength={2} maxLength={80} />
      </FormField>

      <FormField id="cityId" label="Ciudad" error={err.cityId}>
        <NativeSelect {...fieldA11y("cityId", err.cityId)} defaultValue={value("cityId", branch?.cityId ?? cities[0]?.id ?? "")} required>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}, {c.province}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <FormField id="addressLine" label="Dirección" error={err.addressLine}>
        <Input
          {...fieldA11y("addressLine", err.addressLine)}
          defaultValue={value("addressLine", branch?.addressLine ?? "")}
          required
          minLength={3}
          maxLength={160}
          placeholder="San Martín 123"
        />
      </FormField>

      <FormField id="addressNotes" label="Indicaciones (opcional)" error={err.addressNotes}>
        <Input
          {...fieldA11y("addressNotes", err.addressNotes)}
          defaultValue={value("addressNotes", branch?.addressNotes ?? "")}
          maxLength={200}
          placeholder="Frente a la plaza"
        />
      </FormField>

      <FormField id="phone" label="Teléfono de la sucursal (opcional)" error={err.phone}>
        <Input {...fieldA11y("phone", err.phone)} type="tel" defaultValue={value("phone", branch?.phone ?? "")} maxLength={30} />
      </FormField>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Formas de entrega</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="acceptsPickup" defaultChecked={checked("acceptsPickup", branch?.acceptsPickup ?? true)} className="size-4 accent-primary" />
          Retiro en el local
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="acceptsDelivery" defaultChecked={checked("acceptsDelivery", branch?.acceptsDelivery ?? false)} className="size-4 accent-primary" />
          Envío a domicilio (después cargás las zonas y tarifas)
        </label>
      </fieldset>

      {branch && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={checked("active", branch.active)} className="size-4 accent-primary" />
          Sucursal activa
        </label>
      )}

      <div className="flex gap-2">
        <SubmitButton>{branch ? "Guardar sucursal" : "Crear sucursal"}</SubmitButton>
        {cancelHref && (
          <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
            Cancelar
          </Link>
        )}
      </div>
    </form>
  );
}
