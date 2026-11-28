"use server";

import type { CommissionCategory } from "@pedilo/api-client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { adminCall } from "@/lib/api";
import { parseKind } from "@/lib/categories";
import {
  checkbox,
  errorToFormState,
  type FormState,
  formValues,
  optionalInt,
  optionalText,
  text,
} from "@pedilo/web-utils";

function commissionCategory(formData: FormData): CommissionCategory | null {
  return (optionalText(formData, "commissionCategory") as CommissionCategory | undefined) ?? null;
}

export async function createCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const kind = parseKind(formData.get("kind"));
  try {
    await adminCall((api) =>
      api.POST("/v1/admin/categories", {
        body: {
          kind,
          name: text(formData, "name"),
          slug: optionalText(formData, "slug"),
          parentId: optionalText(formData, "parentId") ?? null,
          ...(kind === "MERCHANT" && { commissionCategory: commissionCategory(formData) }),
          sortOrder: optionalInt(formData, "sortOrder"),
          ...(kind === "PRODUCT" && { featuredOrder: optionalInt(formData, "featuredOrder") ?? null }),
          active: checkbox(formData, "active"),
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath("/categories");
  redirect(`/categories?kind=${kind}`);
}

export async function updateCategory(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const kind = parseKind(formData.get("kind"));
  try {
    await adminCall((api) =>
      api.PATCH("/v1/admin/categories/{id}", {
        params: { path: { id } },
        body: {
          name: text(formData, "name"),
          slug: optionalText(formData, "slug"),
          parentId: optionalText(formData, "parentId") ?? null,
          ...(kind === "MERCHANT" && { commissionCategory: commissionCategory(formData) }),
          sortOrder: optionalInt(formData, "sortOrder"),
          ...(kind === "PRODUCT" && { featuredOrder: optionalInt(formData, "featuredOrder") ?? null }),
          active: checkbox(formData, "active"),
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath("/categories");
  redirect(`/categories?kind=${kind}`);
}
