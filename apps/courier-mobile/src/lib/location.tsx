import { ApiError, unwrap } from "@pedilo/api-client";
import { COURIER_LOCATION_DISTANCE_M, COURIER_LOCATION_INTERVAL_MS } from "@pedilo/domain";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import { api } from "./api";
// Fija la fuente del token también cuando la tarea corre sin pantallas (app cerrada).
import "./auth";

/**
 * Seguimiento en vivo (ADR 0022): mientras el repartidor tiene un reparto en curso, la app manda
 * su ubicación a Pedilo cada ~15 s (o cada 10 m). La API guarda solo el último punto y lo borra al
 * terminar; cuando responde `sharing: false` (ya no hay repartos activos) se deja de mandar.
 *
 * - **Segundo plano** (build propio con permiso «todo el tiempo»): una tarea de `expo-location`
 *   con servicio en primer plano de Android (notificación fija), así sigue con la pantalla apagada.
 * - **Primer plano** (Expo Go o sin ese permiso): solo con la app abierta.
 *
 * Es «en vivo»: un punto que no se pudo mandar no se reintenta (el siguiente lo reemplaza).
 */

export type SharingState =
  /** Sin repartos en curso. */
  | "off"
  /** Comparte también con la pantalla apagada. */
  | "background"
  /** Comparte solo con la app abierta. */
  | "foreground"
  /** Sin permiso de ubicación. */
  | "denied"
  /** GPS / ubicación del teléfono apagada. */
  | "gpsOff"
  /** Web: no se comparte. */
  | "unsupported";

const TASK = "pedilo.courier.location";
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
/** Expo Go en Android no permite ubicación en segundo plano: hace falta el build propio (EAS). */
export const backgroundSupported = Platform.OS !== "web" && !inExpoGo;

/** Manda un punto. `false` = la API dice que ya no hay nada que compartir. */
async function sendPoint(loc: Location.LocationObject): Promise<boolean> {
  try {
    const res = await unwrap(
      api.PUT("/v1/courier/location", {
        body: {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracyM: loc.coords.accuracy ?? null,
          // Antigüedad según el reloj del teléfono, no su hora: un reloj mal puesto no rompe nada.
          ageMs: Math.max(0, Math.round(Date.now() - loc.timestamp)),
        },
      }),
    );
    return res.sharing;
  } catch (err) {
    // Sesión cerrada o perfil deshabilitado: no tiene sentido seguir. Sin señal: el próximo punto.
    if (err instanceof ApiError && [401, 403, 404].includes(err.status)) return false;
    return true;
  }
}

async function stopBackground(): Promise<void> {
  if (!backgroundSupported) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch {
    // Ya estaba detenida.
  }
}

if (backgroundSupported) {
  // Tiene que definirse al cargar el módulo (antes de montar pantallas): Android puede despertar
  // la app solo para correr la tarea.
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const latest = data.locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    if (!(await sendPoint(latest))) await stopBackground();
  });
}

async function startBackground(): Promise<void> {
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: COURIER_LOCATION_INTERVAL_MS,
    distanceInterval: COURIER_LOCATION_DISTANCE_M,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    activityType: Location.ActivityType.OtherNavigation,
    foregroundService: {
      notificationTitle: "Envío en curso",
      notificationBody: "Compartís tu ubicación con el comercio y el cliente hasta que termines.",
      notificationColor: "#f2681d",
      killServiceOnDestroy: false,
    },
  });
}

interface LocationSharingValue {
  state: SharingState;
  /** Ya se puede pedir el permiso «todo el tiempo» (build propio, todavía sin otorgar). */
  canUpgrade: boolean;
  /** Pide el permiso de segundo plano (en Android 11+ abre los ajustes). */
  requestBackground: () => Promise<void>;
  /** Para «denegado» sin poder volver a preguntar: abre los ajustes de la app. */
  openSettings: () => void;
  retry: () => void;
}

const LocationSharingContext = createContext<LocationSharingValue | null>(null);

/** `active`: el repartidor tiene al menos un reparto asignado y sin terminar. */
export function LocationSharingProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const [current, setState] = useState<SharingState>("foreground");
  const [upgradable, setCanUpgrade] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lastSent = useRef(0);
  const state: SharingState = !active ? "off" : Platform.OS === "web" ? "unsupported" : current;
  const canUpgrade = state === "foreground" && upgradable;
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!active) {
      void stopBackground();
      return;
    }
    let cancelled = false;
    let watcher: Location.LocationSubscription | null = null;
    void (async () => {
      let fg = await Location.getForegroundPermissionsAsync();
      if (!fg.granted && fg.canAskAgain) fg = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!fg.granted) return setState("denied");
      if (!(await Location.hasServicesEnabledAsync())) return setState("gpsOff");

      if (backgroundSupported) {
        const bg = await Location.getBackgroundPermissionsAsync();
        if (cancelled) return;
        if (bg.granted) {
          await startBackground();
          if (!cancelled) {
            setCanUpgrade(false);
            setState("background");
          }
          return;
        }
        setCanUpgrade(bg.canAskAgain);
      }

      // Solo con la app abierta.
      watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: COURIER_LOCATION_INTERVAL_MS, distanceInterval: COURIER_LOCATION_DISTANCE_M },
        (loc) => {
          if (Date.now() - lastSent.current < COURIER_LOCATION_INTERVAL_MS / 2) return;
          lastSent.current = Date.now();
          void sendPoint(loc);
        },
      );
      if (cancelled) watcher.remove();
      else setState("foreground");
    })().catch(() => {
      if (!cancelled) setState("gpsOff");
    });
    return () => {
      cancelled = true;
      watcher?.remove();
    };
  }, [active, attempt]);

  // Al volver a la app (p. ej. de los ajustes, tras dar permiso o prender el GPS) se reintenta.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && stateRef.current !== "background" && stateRef.current !== "off") retry();
    });
    return () => sub.remove();
  }, [retry]);

  // Al cerrar sesión (se desmontan las pestañas) se deja de compartir.
  useEffect(() => () => void stopBackground(), []);

  const requestBackground = useCallback(async () => {
    await Location.requestBackgroundPermissionsAsync().catch(() => null);
    retry();
  }, [retry]);

  const value = useMemo(
    () => ({ state, canUpgrade, requestBackground, openSettings: () => void Linking.openSettings(), retry }),
    [state, canUpgrade, requestBackground, retry],
  );
  return <LocationSharingContext.Provider value={value}>{children}</LocationSharingContext.Provider>;
}

export function useLocationSharing(): LocationSharingValue {
  const value = useContext(LocationSharingContext);
  if (!value) throw new Error("useLocationSharing fuera de LocationSharingProvider");
  return value;
}
