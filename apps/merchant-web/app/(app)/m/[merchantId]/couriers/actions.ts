"use server";

import { errorToFormState, type FormState, formValues, optionalText, parsePesosToMinor, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { merchantCall } from "@/lib/api";

export async function recordCourierPayment(merchantId: string, courierId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const amountMinor = parsePesosToMinor(text(formData, "amount"));
  if (amountMinor === undefined || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return { message: "Monto inválido", values };
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/courier-balances/{courierId}/payments", {
        params: { path: { merchantId, courierId } },
        body: {
          direction: text(formData, "direction") === "FROM_COURIER" ? "FROM_COURIER" : "TO_COURIER",
          amountMinor,
          note: optionalText(formData, "note") ?? null,
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`/m/${merchantId}/couriers`);
  return { saved: true };
}
