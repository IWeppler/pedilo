"use server";

import type { ClaimResolutionType } from "@pedilo/domain";
import { errorToFormState, type FormState, formValues, optionalText, parsePesosToMinor, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { merchantCall } from "@/lib/api";

const paths = (merchantId: string, claimId: string) => {
  revalidatePath(`/m/${merchantId}/claims`);
  revalidatePath(`/m/${merchantId}/claims/${claimId}`);
};

export async function proposeClaimResolution(merchantId: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const type = text(formData, "type") as ClaimResolutionType;
  let amountMinor: number | null = null;
  if (type === "REFUND_PARTIAL") {
    const parsed = parsePesosToMinor(text(formData, "amount"));
    if (parsed === undefined || !Number.isSafeInteger(parsed) || parsed <= 0) return { message: "Monto inválido", values };
    amountMinor = parsed;
  }
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/claims/{claimId}/propose", {
        params: { path: { merchantId, claimId } },
        body: { type, amountMinor, note: optionalText(formData, "note") ?? null },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  paths(merchantId, claimId);
  return { saved: true };
}

export async function markClaimRefunded(merchantId: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/claims/{claimId}/refunded", {
        params: { path: { merchantId, claimId } },
        body: { note: optionalText(formData, "note") ?? null },
      }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  paths(merchantId, claimId);
  return { saved: true };
}

export async function sendClaimMessage(merchantId: string, claimId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/claims/{claimId}/messages", {
        params: { path: { merchantId, claimId } },
        body: { body: text(formData, "body") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  paths(merchantId, claimId);
  return { saved: true };
}
