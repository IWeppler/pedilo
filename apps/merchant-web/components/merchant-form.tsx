"use client";

import type { Category, City, MerchantDetail } from "@pedilo/api-client";
import { formatCuit } from "@pedilo/domain";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";
import Link from "next/link";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { LocationFields } from "@/components/location-fields";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Datos del comercio. En alta y en borrador/rechazado se edita todo; aprobado solo nombre
 * visible y contacto (el resto aparece deshabilitado: no viaja en el FormData).
 * Con `cities` (el registro) suma dónde está el local y cómo entrega, para cargarlo todo de una.
 */
export function MerchantForm({
  action,
  rubros,
  merchant,
  cities,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  rubros: Category[];
  merchant?: MerchantDetail;
  cities?: City[];
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;
  const fiscalLocked = merchant !== undefined && !["DRAFT", "REJECTED"].includes(merchant.status);

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <FormField id="displayName" label="Nombre del comercio" error={err.displayName} hint="Como lo van a ver los clientes.">
        <Input
          {...fieldA11y("displayName", err.displayName, true)}
          defaultValue={value("displayName", merchant?.displayName ?? "")}
          required
          minLength={2}
          maxLength={80}
          placeholder="Pizzería Don Pepe"
        />
      </FormField>

      <FormField id="categoryId" label="Rubro" error={err.categoryId}>
        <NativeSelect
          {...fieldA11y("categoryId", err.categoryId)}
          defaultValue={value("categoryId", merchant?.categoryId ?? "")}
          required
          disabled={fiscalLocked}
        >
          <option value="" disabled>
            Elegí el rubro
          </option>
          {rubros.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      <FormField id="legalName" label="Razón social o nombre del titular" error={err.legalName}>
        <Input
          {...fieldA11y("legalName", err.legalName)}
          defaultValue={value("legalName", merchant?.legalName ?? "")}
          required
          minLength={2}
          maxLength={120}
          disabled={fiscalLocked}
        />
      </FormField>

      <FormField id="taxId" label="CUIT" error={err.taxId} hint="Con o sin guiones. Lo usamos para verificar el comercio.">
        <Input
          {...fieldA11y("taxId", err.taxId, true)}
          defaultValue={value("taxId", merchant ? formatCuit(merchant.taxId) : "")}
          required
          inputMode="numeric"
          placeholder="20-12345678-6"
          disabled={fiscalLocked}
        />
      </FormField>

      <FormField id="contactPhone" label="Teléfono de contacto" error={err.contactPhone}>
        <Input
          {...fieldA11y("contactPhone", err.contactPhone)}
          type="tel"
          defaultValue={value("contactPhone", merchant?.contactPhone ?? "")}
          required
          minLength={6}
          maxLength={30}
          placeholder="3491 123456"
        />
      </FormField>

      <FormField id="contactEmail" label="Email de contacto (opcional)" error={err.contactEmail}>
        <Input
          {...fieldA11y("contactEmail", err.contactEmail)}
          type="email"
          defaultValue={value("contactEmail", merchant?.contactEmail ?? "")}
        />
      </FormField>

      {cities && (
        <fieldset className="grid gap-4 border-t pt-4">
          <legend className="sr-only">Tu local</legend>
          <div className="grid gap-1" aria-hidden>
            <p className="text-base font-semibold">Tu local</p>
            <p className="text-sm text-muted-foreground">Dónde estás y cómo entregás. Los horarios los cargás en el paso siguiente.</p>
          </div>
          <LocationFields cities={cities} values={v} errors={err} />
        </fieldset>
      )}

      {fiscalLocked && (
        <p className="text-sm text-muted-foreground">
          Rubro, razón social y CUIT ya fueron verificados. Para cambiarlos, escribile al equipo de Pedilo.
        </p>
      )}

      <div className="flex gap-2">
        <SubmitButton>{merchant ? "Guardar cambios" : "Registrar comercio"}</SubmitButton>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
