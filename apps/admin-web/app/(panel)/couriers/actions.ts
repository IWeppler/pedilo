"use server";

import { errorToFormState, type FormState, optionalText, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { adminCall } from "@/lib/api";

export async function reviewCourier(courierId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/couriers/{courierId}/review", {
        params: { path: { courierId } },
        body: {
          status: text(formData, "status") as "APPROVED" | "REJECTED" | "SUSPENDED",
          reason: optionalText(formData, "reason") ?? null,
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath("/couriers");
  return { saved: true };
}
