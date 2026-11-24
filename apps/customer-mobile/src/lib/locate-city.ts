import * as Location from "expo-location";
import { Platform } from "react-native";

/**
 * Detecta la ciudad del usuario con la ubicación del teléfono.
 *
 * Las ciudades de la base no tienen coordenadas: se toma la posición, se pide la dirección al
 * geocodificador del sistema (iOS/Android) y se busca su localidad por nombre entre las ciudades
 * activas. En web no hay geocodificación inversa, así que no se ofrece.
 */

export interface CityOption {
  slug: string;
  name: string;
  province: string;
}

export type LocateResult<C extends CityOption> =
  | { kind: "found"; city: C }
  /** Hay ubicación pero la localidad no es una ciudad donde estemos. */
  | { kind: "not-served"; place: string | null }
  | { kind: "denied"; canAskAgain: boolean }
  | { kind: "services-off" }
  | { kind: "error" };

export const canLocate = Platform.OS === "ios" || Platform.OS === "android";

const TIMEOUT_MS = 15_000;

export async function locateCity<C extends CityOption>(cities: C[]): Promise<LocateResult<C>> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) return { kind: "services-off" };

    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) {
      return { kind: "denied", canAskAgain: permission.canAskAgain };
    }

    // Para saber la ciudad alcanza una posición reciente y de precisión media.
    const position =
      (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000, requiredAccuracy: 5_000 })) ??
      (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), TIMEOUT_MS));

    const [address] = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
    if (!address) return { kind: "not-served", place: null };

    const city = matchCity(cities, address);
    if (city) return { kind: "found", city };
    return { kind: "not-served", place: address.city ?? address.subregion ?? address.district ?? null };
  } catch {
    return { kind: "error" };
  }
}

/** Busca la localidad de la dirección entre las ciudades. Si hay homónimas, gana la de la misma provincia. */
export function matchCity<C extends CityOption>(
  cities: C[],
  address: Pick<Location.LocationGeocodedAddress, "city" | "subregion" | "district" | "name" | "region">,
): C | null {
  const candidates = [address.city, address.district, address.subregion, address.name]
    .filter((v): v is string => Boolean(v))
    .map(normalize);
  const region = address.region ? normalize(address.region) : null;

  for (const candidate of candidates) {
    const matches = cities.filter((c) => normalize(c.name) === candidate);
    if (matches.length === 0) continue;
    return matches.find((c) => region && normalize(c.province) === region) ?? matches[0]!;
  }
  return null;
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

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(ciudad de|municipio de|comuna de)\s+/, "")
    .trim();
