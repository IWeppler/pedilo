"use client";

import type { DeliveryZone } from "@pedilo/api-client";
import { formKey, type FormState, initialFormState, minorToPesosInput } from "@pedilo/web-utils";
import Link from "next/link";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ZoneForm({
  action,
  zone,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  zone?: DeliveryZone;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <FormField id="name" label="Nombre de la zona" error={err.name}>
        <Input {...fieldA11y("name", err.name)} defaultValue={value("name", zone?.name ?? "")} required minLength={2} maxLength={80} placeholder="Centro" />
      </FormField>

      <FormField id="description" label="Qué cubre (opcional)" error={err.description} hint="Barrios o calles, para que el cliente sepa si llega.">
        <Input
          {...fieldA11y("description", err.description, true)}
          defaultValue={value("description", zone?.description ?? "")}
          maxLength={300}
          placeholder="Bv. Roca a Belgrano, de 9 de Julio a Sarmiento"
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="fee" label="Costo de envío ($)" error={err.fee}>
          <Input
            {...fieldA11y("fee", err.fee)}
            inputMode="decimal"
            defaultValue={value("fee", zone ? minorToPesosInput(zone.feeMinor) : "")}
            required
            placeholder="1500"
          />
        </FormField>
        <FormField id="minOrder" label="Pedido mínimo ($)" error={err.minOrder} hint="0 si no hay mínimo.">
          <Input
            {...fieldA11y("minOrder", err.minOrder, true)}
            inputMode="decimal"
            defaultValue={value("minOrder", zone ? minorToPesosInput(zone.minOrderMinor) : "0")}
            placeholder="0"
          />
        </FormField>
      </div>

      {zone && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={v ? v.active === "on" : zone.active} className="size-4 accent-primary" />
          Zona activa
        </label>
      )}

      <div className="flex gap-2">
        <SubmitButton>{zone ? "Guardar zona" : "Crear zona"}</SubmitButton>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
