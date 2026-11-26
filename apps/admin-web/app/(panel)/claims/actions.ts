"use server";

import { errorToFormState, type FormState, formValues, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { adminCall } from "@/lib/api";

export async function resolveClaim(claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/claims/{claimId}/resolve", {
        params: { path: { claimId } },
        body: { to: text(formData, "to") === "CLOSED" ? "CLOSED" : "RESOLVED", note: text(formData, "note") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/claims");
  return { saved: true };
}

export async function sendAdminClaimMessage(claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/claims/{claimId}/messages", { params: { path: { claimId } }, body: { body: text(formData, "body") } }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`/claims/${claimId}`);
  return { saved: true };
}
