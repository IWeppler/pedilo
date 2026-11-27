/** Ubicación del repartidor que manda la API en el seguimiento (ADR 0022). */
export interface CourierLocation {
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string;
}

/** «hace instantes», «hace 40 s», «hace 3 min». */
export function locationAgeLabel(recordedAt: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000));
  if (s < 15) return "hace instantes";
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.round(s / 60)} min`;
}

export const googleMapsUrl = (l: Pick<CourierLocation, "lat" | "lng">) =>
  `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;
