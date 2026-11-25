"use server";

import type { PlanCode } from "@pedilo/api-client";
import { errorToFormState, type FormState, formValues, optionalText, parsePesosToMinor, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { adminCall } from "@/lib/api";

/** Cambiar el plan del comercio desde ahora (ADR 0012). */
export async function changePlan(merchantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await adminCall((api) =>
      api.PUT("/v1/admin/merchants/{merchantId}/plan", {
        params: { path: { merchantId } },
        body: { plan: text(formData, "plan") as PlanCode, reason: optionalText(formData, "reason") ?? null },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`/merchants/${merchantId}`);
  return { saved: true };
}

/** Ajuste manual del saldo: «Crédito» resta deuda, «Cargo» la suma. Monto en pesos. */
export async function addAdjustment(merchantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const amount = parsePesosToMinor(text(formData, "amount"));
  if (amount === undefined || !Number.isSafeInteger(amount) || amount <= 0) {
    return { message: "Revisá los campos marcados.", fieldErrors: { amount: "Monto inválido" }, values };
  }
  const sign = formData.get("direction") === "credit" ? -1 : 1;
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/merchants/{merchantId}/commission-adjustments", {
        params: { path: { merchantId } },
        body: { amountMinor: sign * amount, description: text(formData, "description") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`/merchants/${merchantId}`);
  return { saved: true };
}
