import { divideRoundHalfUp } from "./money";

/**
 * Calificaciones de comercios (SPEC §11.3, ADR 0031): solo quien hizo el pedido, una vez, sobre
 * pedidos entregados o retirados y dentro de un plazo. El promedio se publica recién con un mínimo
 * de calificaciones; los comentarios los ven el comercio y Pedilo.
 */

/** Días para calificar desde que el pedido se entregó o se retiró. */
export const RATING_WINDOW_DAYS = 14;

/** Con menos calificaciones no se muestra el promedio (una o dos opiniones deciden demasiado). */
export const MIN_RATINGS_PUBLIC = 5;

export const MAX_RATING_COMMENT = 500;

export interface RatingSummary {
  /** Promedio con un decimal (half-up), p. ej. 4.6. */
  average: number;
  count: number;
  /** Cuántas de 1 a 5 estrellas (índice 0 = 1 estrella). */
  distribution: [number, number, number, number, number];
}

/** Resumen de una lista de estrellas (1–5). `null` si no hay ninguna. */
export function summarizeRatings(stars: readonly number[]): RatingSummary | null {
  if (stars.length === 0) return null;
  const distribution: RatingSummary["distribution"] = [0, 0, 0, 0, 0];
  let total = 0;
  for (const s of stars) {
    distribution[s - 1]!++;
    total += s;
  }
  // Promedio × 10 con redondeo half-up, para un decimal exacto.
  const average = Number(divideRoundHalfUp(BigInt(total * 10), BigInt(stars.length))) / 10;
  return { average, count: stars.length, distribution };
}

/** El promedio que se puede mostrar al público, o `null` si todavía son pocas. */
export function publicRating(summary: Pick<RatingSummary, "average" | "count"> | null): { average: number; count: number } | null {
  return summary && summary.count >= MIN_RATINGS_PUBLIC ? { average: summary.average, count: summary.count } : null;
}

/** ¿Todavía se puede calificar? (plazo desde la entrega o el retiro). */
export function canRateUntil(completedAt: Date): Date {
  return new Date(completedAt.getTime() + RATING_WINDOW_DAYS * 86_400_000);
}
