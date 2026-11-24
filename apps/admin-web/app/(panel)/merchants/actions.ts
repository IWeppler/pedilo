"use server";

import { errorToFormState, type FormState, formValues, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { adminCall } from "@/lib/api";

export async function approveMerchant(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await adminCall((api) => api.POST("/v1/admin/merchants/{id}/approve", { params: { path: { id } } }));
  } catch (err) {
    return errorToFormState(err, formValues(formData));
  }
  revalidatePath("/merchants");
  redirect("/merchants?status=PENDING_REVIEW");
}

export async function rejectMerchant(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/merchants/{id}/reject", {
        params: { path: { id } },
        body: { reason: text(formData, "reason") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath("/merchants");
  redirect("/merchants?status=PENDING_REVIEW");
}
