"use client";

import type { MenuSection } from "@pedilo/api-client";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import Link from "next/link";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SectionForm({
  action,
  section,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  section: MenuSection;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-md gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FormField id="name" label="Nombre" error={err.name}>
        <Input {...fieldA11y("name", err.name)} defaultValue={v?.name ?? section.name} required minLength={2} maxLength={80} />
      </FormField>
      <FormField id="sortOrder" label="Orden" error={err.sortOrder} hint="Menor número = aparece antes.">
        <Input
          {...fieldA11y("sortOrder", err.sortOrder, true)}
          type="number"
          min={0}
          max={10000}
          defaultValue={v?.sortOrder ?? String(section.sortOrder)}
          className="w-32"
        />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={v ? v.active === "on" : section.active} className="size-4 accent-primary" />
        Visible en el menú (si la ocultás, también se ocultan sus productos)
      </label>
      <div className="flex gap-2">
        <SubmitButton>Guardar sección</SubmitButton>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
