"use server";

import { checkbox, errorToFormState, type FormState, formValues, optionalText, text } from "@pedilo/web-utils";
import { redirect } from "next/navigation";

import { merchantCall } from "@/lib/api";

/**
 * Alta en un solo paso: el comercio y su local (por detrás, la única sucursal, con el nombre del
 * comercio). Si el local falla, el comercio ya quedó creado: se sigue en «Local y entregas», que
 * muestra el formulario vacío para completarlo.
 */
export async function registerMerchant(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const displayName = text(formData, "displayName");
  let merchantId: string;
  try {
    const merchant = await merchantCall((api) =>
      api.POST("/v1/merchants", {
        body: {
          displayName,
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

  let locationSaved = true;
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/branches", {
        params: { path: { merchantId } },
        body: {
          name: displayName,
          cityId: text(formData, "cityId"),
          addressLine: text(formData, "addressLine"),
          addressNotes: optionalText(formData, "addressNotes") ?? null,
          phone: null,
          acceptsPickup: checkbox(formData, "acceptsPickup"),
          acceptsDelivery: checkbox(formData, "acceptsDelivery"),
        },
      }),
    );
  } catch {
    locationSaved = false;
  }
  redirect(`/m/${merchantId}/local${locationSaved ? "" : "?incompleto=1"}`);
}
