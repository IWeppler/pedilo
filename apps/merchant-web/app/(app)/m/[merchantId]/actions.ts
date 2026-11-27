"use server";

import { ApiError, type OpeningRange } from "@pedilo/api-client";
import {
  checkbox,
  errorToFormState,
  type FormState,
  formValues,
  optionalInt,
  optionalMoney,
  optionalText,
  ONBOARDING_ISSUE_LABELS,
  text,
  weekdayLabel,
} from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { merchantCall, merchantUpload } from "@/lib/api";

/** Campo opcional que el usuario puede vaciar: ausente → no se toca; vacío → null. */
function nullableText(formData: FormData, key: string): string | null | undefined {
  return formData.has(key) ? (optionalText(formData, key) ?? null) : undefined;
}

const home = (merchantId: string) => `/m/${merchantId}`;

// --- Perfil y envío a revisión ---

export async function updateProfile(merchantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.PATCH("/v1/merchants/{merchantId}", {
        params: { path: { merchantId } },
        // Los campos bloqueados (comercio aprobado) llegan deshabilitados y no vienen en el FormData.
        body: {
          displayName: optionalText(formData, "displayName"),
          legalName: optionalText(formData, "legalName"),
          taxId: optionalText(formData, "taxId"),
          categoryId: optionalText(formData, "categoryId"),
          contactPhone: optionalText(formData, "contactPhone"),
          contactEmail: nullableText(formData, "contactEmail"),
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(home(merchantId));
  redirect(home(merchantId));
}

export async function submitForReview(merchantId: string): Promise<FormState> {
  try {
    await merchantCall((api) => api.POST("/v1/merchants/{merchantId}/submit", { params: { path: { merchantId } } }));
  } catch (err) {
    if (err instanceof ApiError && err.code === "CONFLICT") {
      const problems = (err.details as { problems?: Array<{ issue: keyof typeof ONBOARDING_ISSUE_LABELS }> })?.problems;
      return { message: problems?.length ? ONBOARDING_ISSUE_LABELS[problems[0]!.issue] : err.message };
    }
    return errorToFormState(err, {});
  }
  revalidatePath(home(merchantId));
  redirect(home(merchantId));
}

// --- Sucursales ---

function branchBody(formData: FormData) {
  return {
    name: text(formData, "name"),
    cityId: text(formData, "cityId"),
    addressLine: text(formData, "addressLine"),
    addressNotes: nullableText(formData, "addressNotes"),
    phone: nullableText(formData, "phone"),
    acceptsPickup: checkbox(formData, "acceptsPickup"),
    acceptsDelivery: checkbox(formData, "acceptsDelivery"),
  };
}

export async function createBranch(merchantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  let branchId: string;
  try {
    const branch = await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/branches", {
        params: { path: { merchantId } },
        body: branchBody(formData),
      }),
    );
    branchId = branch.id;
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(home(merchantId));
  // Siguiente paso natural: cargar horarios y zonas de la sucursal nueva.
  redirect(`${home(merchantId)}/branches/${branchId}`);
}

export async function updateBranch(
  merchantId: string,
  branchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.PATCH("/v1/merchants/{merchantId}/branches/{branchId}", {
        params: { path: { merchantId, branchId } },
        body: { ...branchBody(formData), active: checkbox(formData, "active") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`${home(merchantId)}/branches/${branchId}`);
  return { saved: true };
}

// --- Pedidos programados (ADR 0011) ---

export async function saveScheduling(
  merchantId: string,
  branchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  const enabled = checkbox(formData, "enabled");
  try {
    await merchantCall((api) =>
      api.PATCH("/v1/merchants/{merchantId}/branches/{branchId}", {
        params: { path: { merchantId, branchId } },
        body: {
          scheduling: enabled
            ? {
                enabled,
                leadMinutes: optionalInt(formData, "leadMinutes") ?? Number.NaN,
                maxDays: optionalInt(formData, "maxDays") ?? Number.NaN,
                slotCapacity: optionalInt(formData, "slotCapacity") ?? null,
              }
            : { enabled },
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`${home(merchantId)}/branches/${branchId}`);
  return { saved: true };
}

// --- Logo y portada (ADR 0017) ---

export async function uploadMerchantImage(merchantId: string, kind: "logo" | "cover", _prev: FormState, formData: FormData): Promise<FormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { message: "Elegí una imagen." };
  try {
    await merchantUpload(`/v1/merchants/${merchantId}/images/${kind}`, file);
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`${home(merchantId)}/profile`);
  return { saved: true };
}

export async function removeMerchantImage(merchantId: string, kind: "logo" | "cover"): Promise<FormState> {
  try {
    await merchantCall((api) => api.DELETE("/v1/merchants/{merchantId}/images/{kind}", { params: { path: { merchantId, kind } } }));
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`${home(merchantId)}/profile`);
  return { saved: true };
}

// --- Medios de pago (ADR 0011) ---

export async function savePaymentSettings(merchantId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const acceptsTransfer = checkbox(formData, "acceptsTransfer");
  try {
    await merchantCall((api) =>
      api.PUT("/v1/merchants/{merchantId}/payment-settings", {
        params: { path: { merchantId } },
        body: {
          acceptsCash: checkbox(formData, "acceptsCash"),
          acceptsTransfer,
          transfer: formData.has("holder")
            ? { holder: optionalText(formData, "holder") ?? null, alias: optionalText(formData, "alias") ?? null, cbu: optionalText(formData, "cbu") ?? null }
            : undefined,
        },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`${home(merchantId)}/profile`);
  return { saved: true };
}

// --- Cierres excepcionales (ADR 0018) ---

export async function addClosure(merchantId: string, branchId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/branches/{branchId}/closures", {
        params: { path: { merchantId, branchId } },
        body: { startsOn: text(formData, "startsOn"), endsOn: text(formData, "endsOn"), reason: text(formData, "reason") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, values);
  }
  revalidatePath(`${home(merchantId)}/branches/${branchId}`);
  return { saved: true };
}

export async function removeClosure(merchantId: string, branchId: string, closureId: string): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.DELETE("/v1/merchants/{merchantId}/branches/{branchId}/closures/{closureId}", {
        params: { path: { merchantId, branchId, closureId } },
      }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`${home(merchantId)}/branches/${branchId}`);
  return { saved: true };
}

// --- Horarios ---

const SCHEDULE_ERRORS: Record<string, string> = {
  OVERLAP: "los horarios se superponen",
  EMPTY_RANGE: "abre y cierra a la misma hora",
  INVALID_TIME: "hora inválida",
  INVALID_WEEKDAY: "día inválido",
};

export async function saveHours(
  merchantId: string,
  branchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  let ranges: OpeningRange[];
  try {
    ranges = JSON.parse(String(formData.get("ranges") ?? "[]")) as OpeningRange[];
  } catch {
    return { message: "No se pudo leer el horario." };
  }
  try {
    await merchantCall((api) =>
      api.PUT("/v1/merchants/{merchantId}/branches/{branchId}/hours", {
        params: { path: { merchantId, branchId } },
        body: { ranges },
      }),
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      const problems = (err.details as { problems?: Array<{ error: string; index: number }> })?.problems ?? [];
      const messages = problems.map((p) => {
        const day = ranges[p.index] ? weekdayLabel(ranges[p.index]!.weekday) : "Horario";
        return `${day}: ${SCHEDULE_ERRORS[p.error] ?? p.error}`;
      });
      return { message: messages.length ? messages.join(". ") + "." : err.message };
    }
    return errorToFormState(err, {});
  }
  revalidatePath(`${home(merchantId)}/branches/${branchId}`);
  return { saved: true };
}

// --- Zonas de envío ---

function zoneBody(formData: FormData) {
  return {
    name: text(formData, "name"),
    description: nullableText(formData, "description"),
    feeMinor: optionalMoney(formData, "fee") ?? Number.NaN,
    minOrderMinor: optionalMoney(formData, "minOrder") ?? 0,
  };
}

/** Los montos llegan en pesos; la API valida enteros en centavos. Errores de monto → campo del form. */
function moneyFieldErrors(state: FormState): FormState {
  const fe = { ...state.fieldErrors };
  if (fe.feeMinor) fe.fee = "Monto inválido";
  if (fe.minOrderMinor) fe.minOrder = "Monto inválido";
  return { ...state, fieldErrors: fe };
}

export async function createZone(
  merchantId: string,
  branchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/branches/{branchId}/zones", {
        params: { path: { merchantId, branchId } },
        body: zoneBody(formData),
      }),
    );
  } catch (err) {
    return moneyFieldErrors(errorToFormState(err, values));
  }
  revalidatePath(`${home(merchantId)}/branches/${branchId}`);
  redirect(`${home(merchantId)}/branches/${branchId}#zonas`);
}

export async function updateZone(
  merchantId: string,
  branchId: string,
  zoneId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    await merchantCall((api) =>
      api.PATCH("/v1/merchants/{merchantId}/branches/{branchId}/zones/{zoneId}", {
        params: { path: { merchantId, branchId, zoneId } },
        body: { ...zoneBody(formData), active: checkbox(formData, "active") },
      }),
    );
  } catch (err) {
    return moneyFieldErrors(errorToFormState(err, values));
  }
  revalidatePath(`${home(merchantId)}/branches/${branchId}`);
  redirect(`${home(merchantId)}/branches/${branchId}#zonas`);
}

// --- Mercado Pago (ADR 0021) ---

/** Pide la URL de autorización a la API y manda al dueño a Mercado Pago. Vuelve a Perfil. */
export async function connectMercadoPago(merchantId: string): Promise<void> {
  const { url } = await merchantCall((api) =>
    api.POST("/v1/merchants/{merchantId}/mercadopago/connect", { params: { path: { merchantId } } }),
  );
  redirect(url);
}

export async function disconnectMercadoPago(merchantId: string): Promise<void> {
  await merchantCall((api) => api.DELETE("/v1/merchants/{merchantId}/mercadopago", { params: { path: { merchantId } } }));
  revalidatePath(`${home(merchantId)}/profile`);
}
