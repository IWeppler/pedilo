import { WEEKDAY_NAMES } from "@pedilo/domain";

/**
 * Textos que la app arma con datos del comercio (ADR 0029). En un solo lugar para que el inicio y
 * el menú digan lo mismo.
 */

/** Viaje típico en una ciudad chica (Tostado), sumado a la preparación para el rango con envío. */
const TRAVEL_MINUTES = { min: 10, max: 20 } as const;

/**
 * Tiempo estimado: «25–35 min» con envío, «Listo en 15 min» si es solo retiro. `null` si el
 * comercio no cargó su tiempo de preparación.
 */
export function etaLabel(m: { prepMinutes: number | null; acceptsDelivery: boolean }): string | null {
  if (m.prepMinutes == null) return null;
  if (!m.acceptsDelivery) return `Listo en ${m.prepMinutes} min`;
  return `${m.prepMinutes + TRAVEL_MINUTES.min}–${m.prepMinutes + TRAVEL_MINUTES.max} min`;
}

/** Minutos para ordenar por «Más rápidos» (sin dato, al final). */
export const etaSortKey = (m: { prepMinutes: number | null }) => m.prepMinutes ?? Number.MAX_SAFE_INTEGER;

/** «Abre 20:00», «Abre mañana 11:00», «Abre el lunes 11:00». `null` si no abre en la semana. */
export function opensLabel(next: { inDays: number; weekday: number; time: string } | null): string | null {
  if (!next) return null;
  if (next.inDays === 0) return `Abre ${next.time}`;
  if (next.inDays === 1) return `Abre mañana ${next.time}`;
  return `Abre el ${WEEKDAY_NAMES[next.weekday]!.toLowerCase()} ${next.time}`;
}

/** Cerrado ahora: cuándo abre y, si acepta programados, la invitación a programar. */
export function closedLabel(m: { opensNext: { inDays: number; weekday: number; time: string } | null; schedulingEnabled: boolean }): string {
  const opens = opensLabel(m.opensNext) ?? "Cerrado";
  return m.schedulingEnabled ? `${opens} · Programá tu pedido` : opens;
}
