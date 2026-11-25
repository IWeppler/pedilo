"use server";

import { merchantCall } from "@/lib/api";

/** Web Push del panel (ADR 0009). Las reglas y permisos los aplica la API. */

export async function getPushPublicKey(): Promise<string | null> {
  const { publicKey } = await merchantCall((api) => api.GET("/v1/push/public-key"));
  return publicKey;
}

export async function savePushSubscription(
  merchantId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<{ ok: boolean }> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/push-subscriptions", { params: { path: { merchantId } }, body: subscription }),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function removePushSubscription(merchantId: string, endpoint: string): Promise<{ ok: boolean }> {
  try {
    await merchantCall((api) =>
      api.POST("/v1/merchants/{merchantId}/push-subscriptions/remove", { params: { path: { merchantId } }, body: { endpoint } }),
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function sendTestPush(merchantId: string): Promise<{ ok: boolean }> {
  try {
    await merchantCall((api) => api.POST("/v1/merchants/{merchantId}/push-subscriptions/test", { params: { path: { merchantId } } }));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
