"use client";

import type { City } from "@pedilo/api-client";
import Link from "next/link";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";

const DEFAULT_TIMEZONE = "America/Argentina/Cordoba";

export function CityForm({
  action,
  city,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  city?: City;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  // Si hubo error se muestran los valores enviados; si no, los de la ciudad.
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;
  const active = v ? v.active === "on" : (city?.active ?? true);

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <FormField id="name" label="Nombre" error={err.name}>
        <Input {...fieldA11y("name", err.name)} defaultValue={value("name", city?.name ?? "")} required minLength={2} maxLength={80} />
      </FormField>

      <FormField id="province" label="Provincia" error={err.province}>
        <Input
          {...fieldA11y("province", err.province)}
          defaultValue={value("province", city?.province ?? "Santa Fe")}
          required
          minLength={2}
          maxLength={80}
        />
      </FormField>

      <FormField
        id="slug"
        label="Slug"
        error={err.slug}
        hint={city ? "Aparece en las URLs. Cambiarlo puede romper enlaces compartidos." : "Opcional: si lo dejás vacío se genera desde el nombre."}
      >
        <Input
          {...fieldA11y("slug", err.slug, true)}
          defaultValue={value("slug", city?.slug ?? "")}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={80}
          placeholder="tostado"
        />
      </FormField>

      <FormField id="timezone" label="Zona horaria" error={err.timezone} hint="Formato IANA. Santa Fe usa America/Argentina/Cordoba.">
        <Input
          {...fieldA11y("timezone", err.timezone, true)}
          defaultValue={value("timezone", city?.timezone ?? DEFAULT_TIMEZONE)}
        />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={active} className="size-4 accent-primary" />
        Activa (visible en las apps)
      </label>

      <div className="flex gap-2">
        <SubmitButton>{city ? "Guardar cambios" : "Crear ciudad"}</SubmitButton>
        <Link href="/cities" className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
