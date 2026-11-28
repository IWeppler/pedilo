"use client";

import { formKey, type FormState, initialFormState, minorToPesosInput } from "@pedilo/web-utils";
import Link from "next/link";
import { useActionState, useState } from "react";

import { FormField, fieldA11y } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isoToLocalInput } from "@/lib/datetime";

export interface PromotionValues {
  kind: "OFFER" | "COUPON";
  code: string | null;
  title: string;
  discountType: "PERCENT" | "FIXED";
  value: number;
  productIds: string[] | null;
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
  startsAt: string;
  endsAt: string | null;
  maxRedemptions: number | null;
  perCustomerLimit: number | null;
  active: boolean;
}

/**
 * Oferta automática o cupón con código (ADR 0030). Lo paga el comercio: la comisión se calcula
 * sobre lo que cobrás después del descuento.
 */
export function PromotionForm({
  action,
  kind,
  promotion,
  products,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  kind: "OFFER" | "COUPON";
  promotion?: PromotionValues;
  products: Array<{ id: string; name: string }>;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, initialFormState);
  const v = state.values;
  const err = state.fieldErrors ?? {};
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;
  const [discountType, setDiscountType] = useState<"PERCENT" | "FIXED">((v?.discountType as "PERCENT" | "FIXED") ?? promotion?.discountType ?? "PERCENT");
  const [scope, setScope] = useState<"ALL" | "PRODUCTS">((v?.scope as "ALL" | "PRODUCTS") ?? (promotion?.productIds ? "PRODUCTS" : "ALL"));
  const coupon = kind === "COUPON";
  const selected = new Set(promotion?.productIds ?? []);
  const active = v ? v.active === "on" : (promotion?.active ?? true);

  return (
    <form key={formKey(v)} action={formAction} className="grid max-w-xl gap-5">
      <input type="hidden" name="kind" value={kind} />
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <FormField id="title" label="Nombre que ve el cliente" error={err.title} hint={coupon ? "Por ejemplo: «Bienvenida»." : "Por ejemplo: «20% en pizzas» o «Martes de empanadas»."}>
        <Input {...fieldA11y("title", err.title)} defaultValue={value("title", promotion?.title ?? "")} required minLength={3} maxLength={60} />
      </FormField>

      {coupon && (
        <FormField id="code" label="Código" error={err.code} hint="Lo escribe el cliente al pedir. 3 a 20 letras o números; mayúsculas y minúsculas dan igual.">
          <Input
            {...fieldA11y("code", err.code)}
            defaultValue={value("code", promotion?.code ?? "")}
            required
            minLength={3}
            maxLength={20}
            className="w-56 uppercase"
            autoCapitalize="characters"
          />
        </FormField>
      )}

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Descuento</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ["PERCENT", "Porcentaje"],
              ["FIXED", "Monto fijo"],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2">
              <input type="radio" name="discountType" value={id} checked={discountType === id} onChange={() => setDiscountType(id)} className="size-4 accent-primary" />
              {label}
            </label>
          ))}
        </div>
        {discountType === "PERCENT" ? (
          <div className="flex flex-wrap gap-4">
            <FormField id="percent" label="Porcentaje" error={err.percent}>
              <div className="flex items-center gap-2">
                <Input
                  {...fieldA11y("percent", err.percent)}
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={value("percent", promotion?.discountType === "PERCENT" ? String(promotion.value) : "")}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </FormField>
            <FormField id="maxDiscount" label="Tope del descuento (opcional)" error={err.maxDiscount} hint="Nunca descuenta más que esto.">
              <Input
                {...fieldA11y("maxDiscount", err.maxDiscount, true)}
                inputMode="decimal"
                placeholder="$"
                defaultValue={value("maxDiscount", promotion?.maxDiscountMinor ? minorToPesosInput(promotion.maxDiscountMinor) : "")}
                className="w-36"
              />
            </FormField>
          </div>
        ) : (
          <FormField id="amount" label="Monto ($)" error={err.amount} hint="Se descuenta del pedido, nunca más que lo que suman los productos alcanzados.">
            <Input
              {...fieldA11y("amount", err.amount)}
              inputMode="decimal"
              defaultValue={value("amount", promotion?.discountType === "FIXED" ? minorToPesosInput(promotion.value) : "")}
              className="w-36"
            />
          </FormField>
        )}
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Aplica a</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ["ALL", "Todo el menú"],
              ["PRODUCTS", "Productos elegidos"],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className="flex items-center gap-2">
              <input type="radio" name="scope" value={id} checked={scope === id} onChange={() => setScope(id)} className="size-4 accent-primary" />
              {label}
            </label>
          ))}
        </div>
        {scope === "PRODUCTS" && (
          <div className="grid max-h-64 gap-1 overflow-y-auto rounded-lg border p-3" role="group" aria-label="Productos" aria-describedby={err.productIds ? "productIds-error" : undefined}>
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no cargaste productos.</p>
            ) : (
              products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="productIds" value={p.id} defaultChecked={selected.has(p.id)} className="size-4 accent-primary" />
                  {p.name}
                </label>
              ))
            )}
          </div>
        )}
        {err.productIds && (
          <p id="productIds-error" className="text-sm text-destructive">
            {err.productIds}
          </p>
        )}
      </fieldset>

      <FormField id="minSubtotal" label="Pedido mínimo (opcional)" error={err.minSubtotal} hint="Subtotal de productos, antes del descuento y sin el envío.">
        <Input
          {...fieldA11y("minSubtotal", err.minSubtotal, true)}
          inputMode="decimal"
          placeholder="$"
          defaultValue={value("minSubtotal", promotion?.minSubtotalMinor ? minorToPesosInput(promotion.minSubtotalMinor) : "")}
          className="w-36"
        />
      </FormField>

      <div className="flex flex-wrap gap-4">
        <FormField id="startsAt" label="Desde" error={err.startsAt} hint="Vacío = desde ahora.">
          <Input {...fieldA11y("startsAt", err.startsAt, true)} type="datetime-local" defaultValue={value("startsAt", isoToLocalInput(promotion?.startsAt))} />
        </FormField>
        <FormField id="endsAt" label="Hasta (opcional)" error={err.endsAt} hint="Vacío = sin fecha de fin.">
          <Input {...fieldA11y("endsAt", err.endsAt, true)} type="datetime-local" defaultValue={value("endsAt", isoToLocalInput(promotion?.endsAt))} />
        </FormField>
      </div>

      <div className="flex flex-wrap gap-4">
        <FormField id="maxRedemptions" label="Cupo total (opcional)" error={err.maxRedemptions} hint="Cuántos pedidos en total. Vacío = sin límite.">
          <Input
            {...fieldA11y("maxRedemptions", err.maxRedemptions, true)}
            type="number"
            min={1}
            defaultValue={value("maxRedemptions", promotion?.maxRedemptions != null ? String(promotion.maxRedemptions) : "")}
            className="w-32"
          />
        </FormField>
        <FormField
          id="perCustomerLimit"
          label="Usos por cliente"
          error={err.perCustomerLimit}
          hint={coupon ? "Lo normal es 1." : "Vacío = sin límite."}
        >
          <Input
            {...fieldA11y("perCustomerLimit", err.perCustomerLimit, true)}
            type="number"
            min={1}
            defaultValue={value("perCustomerLimit", promotion ? (promotion.perCustomerLimit != null ? String(promotion.perCustomerLimit) : "") : coupon ? "1" : "")}
            className="w-32"
          />
        </FormField>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={active} className="size-4 accent-primary" />
        Activa (si la desactivás, deja de aplicarse y desaparece de la app)
      </label>

      <p className="text-sm text-muted-foreground">El descuento lo pagás vos: la comisión de Pedilo se calcula sobre lo que cobrás después del descuento.</p>

      <div className="flex gap-2">
        <SubmitButton>{promotion ? "Guardar cambios" : coupon ? "Crear cupón" : "Crear oferta"}</SubmitButton>
        <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
          Cancelar
        </Link>
      </div>
    </form>
  );
}
