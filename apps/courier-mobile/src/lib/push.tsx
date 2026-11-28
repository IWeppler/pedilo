import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import { api } from "./api";

/**
 * Ofertas con la app cerrada (Expo Push sobre FCM, ADR 0025).
 *
 * Funciona en un build propio con el proyecto de EAS (`extra.eas.projectId`) y las credenciales de
 * FCM cargadas en EAS. En Expo Go (Android, desde el SDK 53), en un emulador o en web no hay token:
 * se omite y la bandeja sigue consultando cada 8 s con la app abierta.
 */

/** Mismo id que manda la API (`OFFER_CHANNEL_ID`). */
const OFFER_CHANNEL_ID = "offers";

// Con la app abierta también se muestra: puede estar en otra pestaña.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export type PushStatus = "granted" | "denied" | "unsupported";

let registeredToken: string | null = null;

const projectId = () => (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
const pushSupported = () => Platform.OS !== "web" && Device.isDevice && Boolean(projectId());

/** Canal propio para las ofertas: suena y aparece arriba aunque el celular esté bloqueado. */
async function ensureOfferChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(OFFER_CHANNEL_ID, {
    name: "Ofertas de envío",
    description: "Avisa cuando hay un envío para tomar en tu ciudad.",
    // eslint-disable-next-line import/namespace -- AndroidImportance se reexporta con `export *`; el plugin no lo sigue
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 400, 200, 400],
    // eslint-disable-next-line import/namespace -- ídem
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

/**
 * Pide permiso (si hace falta) y registra este celular para recibir ofertas. Best-effort: nunca
 * falla hacia afuera. Devuelve en qué quedó el permiso.
 */
export async function registerForOffers(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  try {
    await ensureOfferChannel();
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (current.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return "denied";
    const expoToken = (await Notifications.getExpoPushTokenAsync({ projectId: projectId()! })).data;
    const { error } = await api.POST("/v1/courier/push-token", { body: { expoToken } });
    if (!error) registeredToken = expoToken;
    return "granted";
  } catch {
    // Sin Google Play Services, sin red al pedir el token, etc.: la bandeja sigue consultando.
    return "unsupported";
  }
}

/** Al cerrar sesión: este celular deja de recibir ofertas de esta cuenta. */
export async function unregisterForOffers(): Promise<void> {
  const expoToken = registeredToken;
  registeredToken = null;
  if (!expoToken) return;
  await api.POST("/v1/courier/push-token/remove", { body: { expoToken } }).catch(() => undefined);
}

/** Permiso negado: se puede volver a pedir, o hay que activarlo desde los ajustes del sistema. */
export async function askAgainForOffers(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  const current = await Notifications.getPermissionsAsync();
  if (!current.granted && !current.canAskAgain) {
    await Linking.openSettings();
    return "denied";
  }
  return registerForOffers();
}

// ---------------------------------------------------------------------------
// En la app: registro al entrar, estado del permiso y refresco al llegar una oferta
// ---------------------------------------------------------------------------

interface OfferPushValue {
  status: PushStatus | "checking";
  askAgain: () => void;
}

const OfferPushContext = createContext<OfferPushValue>({ status: "unsupported", askAgain: () => undefined });

/** Para repartidores aprobados: registra el celular y mantiene el estado del permiso. */
export function OfferPushProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PushStatus | "checking">("checking");

  useEffect(() => {
    let cancelled = false;
    const register = () => void registerForOffers().then((s) => !cancelled && setStatus(s));
    register();
    if (!pushSupported()) return;
    // Volvió de los ajustes del sistema con el permiso activado: se registra sin volver a preguntar.
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void Notifications.getPermissionsAsync().then((p) => {
        if (p.granted) register();
        else if (!cancelled) setStatus("denied");
      });
    });
    // FCM puede rotar el token: se vuelve a registrar.
    const tokenSub = Notifications.addPushTokenListener(() => register());
    // Con la app abierta, la oferta aparece en la bandeja sin esperar la próxima consulta.
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ["courier", "offers"] });
    });
    return () => {
      cancelled = true;
      appState.remove();
      tokenSub.remove();
      received.remove();
    };
  }, [queryClient]);

  const askAgain = useCallback(() => void askAgainForOffers().then(setStatus), []);
  const value = useMemo(() => ({ status, askAgain }), [status, askAgain]);
  return <OfferPushContext.Provider value={value}>{children}</OfferPushContext.Provider>;
}

export const useOfferPush = () => useContext(OfferPushContext);

/** Tocar el aviso de una oferta abre la bandeja. */
export function OfferNotificationRouter() {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = response?.notification.request.content.data?.url;
    if (url === "/") router.navigate("/");
  }, [response, router]);
  return null;
}
