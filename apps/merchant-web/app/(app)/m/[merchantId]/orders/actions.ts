"use server";

import type { OrderStatus } from "@pedilo/api-client";
import { errorToFormState, type FormState, formValues, optionalText } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { merchantCall } from "@/lib/api";

/** Cambio de estado de un pedido. Las reglas las aplica la API (merchantOrderActions). */
export async function transitionOrder(
  merchantId: string,
  orderId: string,
  to: OrderStatus,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/orders/{orderId}/transition", {
        params: { path: { merchantId, orderId } },
        body: { to, reason: optionalText(formData, "reason") ?? null },
      }),
    );
  } catch (err) {
    return errorToFormState(err, formValues(formData));
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { saved: true };
}
