"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { adminCall } from "@/lib/api";
import { checkbox, errorToFormState, type FormState, formValues, optionalText, text } from "@pedilo/web-utils";

/** La API valida permisos y datos; acá solo se arma el body y se traducen los errores. */
export async function createCity(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/cities", {
        body: {
          name: text(formData, "name"),
          province: text(formData, "province"),
          slug: optionalText(formData, "slug"),
          timezone: optionalText(formData, "timezone"),
          active: checkbox(formData, "active"),
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath("/cities");
  redirect("/cities");
}

export async function updateCity(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await adminCall((api) =>
      api.PATCH("/v1/admin/cities/{id}", {
        params: { path: { id } },
        body: {
          name: text(formData, "name"),
          province: text(formData, "province"),
          slug: optionalText(formData, "slug"),
          timezone: optionalText(formData, "timezone"),
          active: checkbox(formData, "active"),
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath("/cities");
  redirect("/cities");
}
