"use server";

import { errorToFormState, type FormState, formValues, optionalText, text } from "@pedilo/web-utils";
import { redirect } from "next/navigation";

import { merchantCall } from "@/lib/api";

export async function registerMerchant(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  let merchantId: string;
  try {
    const merchant = await merchantCall((api) =>
      api.POST("/v1/merchants", {
        body: {
          displayName: text(formData, "displayName"),
          legalName: text(formData, "legalName"),
          taxId: text(formData, "taxId"),
          categoryId: text(formData, "categoryId"),
          contactPhone: text(formData, "contactPhone"),
          contactEmail: optionalText(formData, "contactEmail") ?? null,
        },
      }),
    );
    merchantId = merchant.id;
  } catch (err) {
    return errorToFormState(err, values);
  }
  redirect(`/m/${merchantId}`);
}
