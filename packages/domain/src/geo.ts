/** Un punto en el mapa (grados decimales, WGS84). */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Distancia en línea recta (fórmula del haversine), en metros. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Punto de entrega marcado por el cliente (ADR 0023): si la sucursal tiene ubicación, el pin no
 * puede quedar más lejos que esto (evita un pin soltado en otra ciudad por error).
 */
export const MAX_DROPOFF_DISTANCE_M = 30_000;
