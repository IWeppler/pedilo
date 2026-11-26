"use server";

import { ApiError, type ProductBody } from "@pedilo/api-client";
import {
  checkbox,
  describeMenuProblems,
  errorToFormState,
  type FormState,
  formValues,
  optionalInt,
  text,
} from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { merchantCall, merchantUpload } from "@/lib/api";

const menuPath = (merchantId: string) => `/m/${merchantId}/menu`;

// --- Fotos (ADR 0017) ---

function fileFrom(formData: FormData): File | null {
  const file = formData.get("file");
  return file instanceof File && file.size > 0 ? file : null;
}

export async function uploadProductImage(merchantId: string, productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const file = fileFrom(formData);
  if (!file) return { message: "Elegí una imagen." };
  try {
    await merchantUpload(`/v1/merchants/${merchantId}/menu/products/${productId}/image`, file);
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(menuPath(merchantId));
  revalidatePath(`${menuPath(merchantId)}/products/${productId}`);
  return { saved: true };
}

export async function removeProductImage(merchantId: string, productId: string): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.DELETE("/v1/merchants/{merchantId}/menu/products/{productId}/image", { params: { path: { merchantId, productId } } }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(menuPath(merchantId));
  revalidatePath(`${menuPath(merchantId)}/products/${productId}`);
  return { saved: true };
}

// --- Secciones ---

export async function createSection(merchantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/menu/sections", {
        params: { path: { merchantId } },
        body: { name: text(formData, "name"), sortOrder: optionalInt(formData, "sortOrder") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(menuPath(merchantId));
  return { saved: true };
}

export async function updateSection(
  merchantId: string,
  sectionId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.PATCH("/v1/merchants/{merchantId}/menu/sections/{sectionId}", {
        params: { path: { merchantId, sectionId } },
        body: {
          name: text(formData, "name"),
          sortOrder: optionalInt(formData, "sortOrder"),
          active: checkbox(formData, "active"),
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(menuPath(merchantId));
  redirect(menuPath(merchantId));
}

// --- Productos ---

/** Pausar / reanudar desde el listado (botón dentro de un <form>). */
export async function setAvailability(merchantId: string, productId: string, available: boolean) {
  await merchantCall((api) =>
    api.PATCH("/v1/merchants/{merchantId}/menu/products/{productId}/availability", {
      params: { path: { merchantId, productId } },
      body: { available },
    }),
  );
  revalidatePath(menuPath(merchantId));
}

/**
 * El editor manda el producto completo como JSON (lista dinámica de variantes y grupos).
 * La validación real la hace la API con las reglas de @pedilo/domain.
 */
export async function saveProduct(
  merchantId: string,
  productId: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let body: ProductBody;
  try {
    body = JSON.parse(String(formData.get("product") ?? "")) as ProductBody;
  } catch {
    return { message: "No se pudo leer el producto." };
  }

  try {
    if (productId) {
      await merchantCall((api) =>
        api.PUT("/v1/merchants/{merchantId}/menu/products/{productId}", {
          params: { path: { merchantId, productId } },
          body,
        }),
      );
    } else {
      await merchantCall((api) =>
        api.POST("/v1/merchants/{merchantId}/menu/products", { params: { path: { merchantId } }, body }),
      );
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      const problems = (err.details as { problems?: Array<{ issue: string; path: string }> } | undefined)?.problems;
      if (problems?.length) return { message: describeMenuProblems(problems, body) };
    }
    return errorToFormState(err, {});
  }
  revalidatePath(menuPath(merchantId));
  redirect(menuPath(merchantId));
}
