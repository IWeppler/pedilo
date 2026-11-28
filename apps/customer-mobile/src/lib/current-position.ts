import type { LatLng } from "@pedilo/domain";
import * as Location from "expo-location";
import { Platform } from "react-native";

/**
 * Ubicación actual del teléfono para «¿Desde dónde pedís?» (ADR 0034). El permiso se pide solo
 * cuando el cliente toca «Usar mi ubicación»; para el aviso de «estás lejos» se usa únicamente si
 * ya lo dio antes.
 */

const TIMEOUT_MS = 15_000;

/** La posición, solo si el permiso ya está dado (nunca lo pide). `null` si no hay o tarda. */
export async function positionIfAllowed(): Promise<LatLng | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return null;
    const position =
      (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 200 })) ??
      (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), TIMEOUT_MS));
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

export type LocateMeResult =
  | { kind: "found"; location: LatLng; /** Calle y número sugeridos (en web no hay geocodificación inversa). */ line: string | null }
  | { kind: "denied" }
  | { kind: "services-off" }
  | { kind: "error" };

/** Pide el permiso (si hace falta), toma la posición precisa y sugiere la dirección. */
export async function locateMe(): Promise<LocateMeResult> {
  try {
    if (Platform.OS !== "web" && !(await Location.hasServicesEnabledAsync())) return { kind: "services-off" };
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return { kind: "denied" };
    const position = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), TIMEOUT_MS);
    const location = { lat: position.coords.latitude, lng: position.coords.longitude };
    let line: string | null = null;
    if (Platform.OS !== "web") {
      const [place] = await Location.reverseGeocodeAsync({ latitude: location.lat, longitude: location.lng }).catch(() => []);
      if (place?.street) line = [place.street, place.streetNumber].filter(Boolean).join(" ");
    }
    return { kind: "found", location, line };
  } catch {
    return { kind: "error" };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
