"use server";

import { checkbox, errorToFormState, type FormState, formValues, optionalInt, optionalMoney, optionalText, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { merchantCall } from "@/lib/api";
import { localInputToIso } from "@/lib/datetime";

const list = (merchantId: string) => `/m/${merchantId}/promotions`;

/**
 * Crea o edita una promoción (ADR 0030). Los montos se tipean en pesos; las fechas, en hora de
 * Argentina. Vacío en «hasta», cupo o mínimo = sin límite.
 */
export async function savePromotion(merchantId: string, promotionId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const kind = text(formData, "kind") === "COUPON" ? "COUPON" : "OFFER";
  const discountType = text(formData, "discountType") === "FIXED" ? "FIXED" : "PERCENT";
  const value = discountType === "PERCENT" ? optionalInt(formData, "percent") : optionalMoney(formData, "amount");
  const minSubtotal = optionalMoney(formData, "minSubtotal");
  const maxDiscount = discountType === "PERCENT" ? optionalMoney(formData, "maxDiscount") : undefined;
  const scope = text(formData, "scope");
  const productIds = scope === "PRODUCTS" ? formData.getAll("productIds").map(String) : null;

  const fieldErrors: Record<string, string> = {};
  if (value === undefined || Number.isNaN(value)) fieldErrors[discountType === "PERCENT" ? "percent" : "amount"] = "Poné cuánto descuenta.";
  if (minSubtotal !== undefined && Number.isNaN(minSubtotal)) fieldErrors.minSubtotal = "Monto inválido.";
  if (maxDiscount !== undefined && Number.isNaN(maxDiscount)) fieldErrors.maxDiscount = "Monto inválido.";
  if (productIds && productIds.length === 0) fieldErrors.productIds = "Elegí al menos un producto.";
  if (Object.keys(fieldErrors).length > 0) return { message: "Revisá los campos marcados.", fieldErrors, values };

  const body = {
    kind,
    code: kind === "COUPON" ? (optionalText(formData, "code") ?? "") : null,
    title: text(formData, "title"),
    discountType,
    value: value!,
    productIds,
    minSubtotalMinor: minSubtotal ?? 0,
    maxDiscountMinor: maxDiscount ?? null,
    startsAt: localInputToIso(optionalText(formData, "startsAt")),
    endsAt: localInputToIso(optionalText(formData, "endsAt")),
    maxRedemptions: optionalInt(formData, "maxRedemptions") ?? null,
    perCustomerLimit: optionalInt(formData, "perCustomerLimit") ?? null,
    active: checkbox(formData, "active"),
  } as const;

  try {
    await merchantCall((api) =>
      promotionId
        ? api.PUT("/v1/merchants/{merchantId}/promotions/{promotionId}", { params: { path: { merchantId, promotionId } }, body })
        : api.POST("/v1/merchants/{merchantId}/promotions", { params: { path: { merchantId } }, body }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(list(merchantId));
  redirect(list(merchantId));
}
