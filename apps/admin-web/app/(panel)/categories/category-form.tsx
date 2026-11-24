"use client";

import type { Category, CategoryKind } from "@pedilo/api-client";
import Link from "next/link";
import { useActionState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { NativeSelect } from "@/components/native-select";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COMMISSION_OPTIONS, KIND_SINGULAR, type CategoryNode } from "@/lib/categories";
import { formKey, type FormState, initialFormState } from "@pedilo/web-utils";

export function CategoryForm({
  action,
  kind,
  category,
  parentOptions,
  defaultParentId,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  kind: CategoryKind;
  category?: Category;
  /** Posibles padres, en orden de árbol (ya sin la propia categoría ni sus descendientes). */
  parentOptions: CategoryNode[];
  defaultParentId?: string | undefined;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;
  const active = v ? v.active === "on" : (category?.active ?? true);
  const listHref = `/categories?kind=${kind}`;

  return (
    // `key`: al volver con errores se remonta el form para que selects y checkboxes tomen los
    // valores enviados (React 19 resetea el form tras la acción y los selects vuelven al default inicial).
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-4">
      <input type="hidden" name="kind" value={kind} />

      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <FormField id="name" label="Nombre" error={err.name}>
        <Input
          {...fieldA11y("name", err.name)}
          defaultValue={value("name", category?.name ?? "")}
          required
          minLength={2}
          maxLength={80}
        />
      </FormField>

      <FormField
        id="slug"
        label="Slug"
        error={err.slug}
        hint={category ? "Aparece en URLs y filtros." : "Opcional: si lo dejás vacío se genera desde el nombre."}
      >
        <Input
          {...fieldA11y("slug", err.slug, true)}
          defaultValue={value("slug", category?.slug ?? "")}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          maxLength={80}
        />
      </FormField>

      <FormField id="parentId" label="Categoría padre" error={err.parentId} hint="Opcional. Solo del mismo tipo.">
        <NativeSelect
          {...fieldA11y("parentId", err.parentId, true)}
          defaultValue={value("parentId", category?.parentId ?? defaultParentId ?? "")}
        >
          <option value="">— Sin padre (raíz) —</option>
          {parentOptions.map(({ category: c, depth }) => (
            <option key={c.id} value={c.id}>
              {"  ".repeat(depth)}
              {c.name}
              {c.active ? "" : " (inactiva)"}
            </option>
          ))}
        </NativeSelect>
      </FormField>

      {kind === "MERCHANT" && (
        <FormField
          id="commissionCategory"
          label="Categoría de comisión"
          error={err.commissionCategory}
          hint="Define el tope de comisión por pedido de los comercios de este rubro (SPEC §6.2). Valores de la hipótesis v0.4."
        >
          <NativeSelect
            {...fieldA11y("commissionCategory", err.commissionCategory, true)}
            defaultValue={value("commissionCategory", category?.commissionCategory ?? "")}
          >
            <option value="">— Sin asignar —</option>
            {COMMISSION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </FormField>
      )}

      <FormField id="sortOrder" label="Orden" error={err.sortOrder} hint="Menor número = aparece antes. Empates por nombre.">
        <Input
          {...fieldA11y("sortOrder", err.sortOrder, true)}
          type="number"
          min={0}
          max={10000}
          step={1}
          defaultValue={value("sortOrder", String(category?.sortOrder ?? 0))}
          className="w-32"
        />
      </FormField>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={active} className="size-4 accent-primary" />
        Activa (si la desactivás, se oculta también toda su rama)
      </label>

      <div className="flex gap-2">
        <SubmitButton>{category ? "Guardar cambios" : `Crear ${KIND_SINGULAR[kind]}`}</SubmitButton>
        <Link href={listHref} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
