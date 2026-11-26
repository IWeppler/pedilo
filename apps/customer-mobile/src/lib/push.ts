import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { api } from "./api";

/**
 * Avisos del pedido al celular (Expo Push, ADR 0020): por ahora, novedades de reclamos.
 *
 * Funciona en un build propio de la app con un proyecto de EAS (`extra.eas.projectId`). En Expo
 * Go (Android, desde el SDK 53) o en un emulador no hay token: se omite sin molestar al usuario.
 */

// Con la app abierta también se muestra el aviso.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let cachedToken: string | null | undefined;

async function expoPushToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!Device.isDevice || !projectId) return null;
  try {
    if (Platform.OS === "android") {
      // eslint-disable-next-line import/namespace -- AndroidImportance se reexporta con `export *`; el plugin no lo sigue
      await Notifications.setNotificationChannelAsync("default", { name: "Pedidos", importance: Notifications.AndroidImportance.HIGH });
    }
    const current = await Notifications.getPermissionsAsync();
    const status = current.granted ? "granted" : (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return null;
    cachedToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    // Expo Go sin soporte de push, sin Google Play Services, etc.
  }
  return cachedToken;
}

/** Asocia este celular al pedido para recibir sus avisos. Best-effort: nunca falla hacia afuera. */
export async function registerOrderForPush(orderId: string, trackingToken: string): Promise<void> {
  const expoToken = await expoPushToken();
  if (!expoToken) return;
  await api
    .POST("/v1/public/orders/{orderId}/push-token", {
      params: { path: { orderId }, header: { "x-order-token": trackingToken } },
      body: { expoToken },
    })
    .catch(() => undefined);
}
