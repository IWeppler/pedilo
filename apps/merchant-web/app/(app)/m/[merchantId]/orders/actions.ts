"use server";

import type { OrderStatus } from "@pedilo/api-client";
import { errorToFormState, type FormState, formValues, optionalText, parsePesosToMinor, text } from "@pedilo/web-utils";
import { revalidatePath } from "next/cache";

import { merchantCall } from "@/lib/api";

/** Cambio de estado de un pedido. Las reglas las aplica la API (merchantOrderActions). */
export async function transitionOrder(
  merchantId: string,
  orderId: string,
  to: OrderStatus,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/orders/{orderId}/transition", {
        params: { path: { merchantId, orderId } },
        body: { to, reason: optionalText(formData, "reason") ?? null },
      }),
    );
  } catch (err) {
    return errorToFormState(err, formValues(formData));
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { saved: true };
}

/** El comercio confirma que cobró el efectivo o que le llegó la transferencia (ADR 0011). */
export async function confirmPayment(merchantId: string, orderId: string): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/orders/{orderId}/payment/confirm", { params: { path: { merchantId, orderId } } }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { saved: true };
}

// --- Reparto con repartidores de Pedilo (ADR 0014) ---

function feeFrom(formData: FormData): number | null {
  const fee = parsePesosToMinor(text(formData, "fee"));
  return fee === undefined || !Number.isSafeInteger(fee) || fee < 0 ? null : fee;
}

export async function requestDispatch(merchantId: string, orderId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const feeMinor = feeFrom(formData);
  if (feeMinor === null) return { message: "Monto inválido" };
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/orders/{orderId}/delivery", {
        params: { path: { merchantId, orderId } },
        body: { feeMinor, requirePin: formData.get("requirePin") === "on" },
      }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { saved: true };
}

export async function reofferDispatch(merchantId: string, deliveryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const feeMinor = feeFrom(formData);
  if (feeMinor === null) return { message: "Monto inválido" };
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/deliveries/{deliveryId}/reoffer", { params: { path: { merchantId, deliveryId } }, body: { feeMinor } }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { saved: true };
}

export async function cancelDispatch(merchantId: string, deliveryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/deliveries/{deliveryId}/cancel", {
        params: { path: { merchantId, deliveryId } },
        body: { reason: text(formData, "reason") },
      }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { saved: true };
}

/** Desbloquear el PIN de entrega (demasiados intentos del repartidor). */
export async function resetDispatchPin(merchantId: string, deliveryId: string): Promise<FormState> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/deliveries/{deliveryId}/reset-pin", { params: { path: { merchantId, deliveryId } } }),
    );
  } catch (err) {
    return errorToFormState(err, {});
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { saved: true };
}

/** Marca pedidos como vistos (apaga la alarma). Lo llama el aviso de pedidos nuevos. */
export async function acknowledgeOrders(merchantId: string, orderIds: string[]): Promise<{ ok: boolean }> {
  if (orderIds.length === 0) return { ok: true };
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/orders/ack", { params: { path: { merchantId } }, body: { orderIds } }),
    );
  } catch {
    return { ok: false };
  }
  revalidatePath(`/m/${merchantId}/orders`);
  return { ok: true };
}
