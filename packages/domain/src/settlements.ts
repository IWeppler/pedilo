import { localWeekdayMinute } from "./schedule";

/**
 * Liquidación semanal de comisiones (SPEC §8.4, ADR 0013).
 *
 * - Corte: lunes 00:00 en la zona horaria de liquidación. Una semana va de un corte al siguiente.
 * - El estado no se guarda: sale del total, lo pagado y el vencimiento.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Último corte semanal (lunes 00:00 local) que ya pasó en `now`. Si `now` es justo el corte,
 * devuelve ese mismo instante. Supone que la zona no cambia de horario dentro de la semana
 * (Argentina no tiene horario de verano).
 */
export function lastWeeklyCutoff(now: Date, timeZone: string): Date {
  const floored = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS;
  const { weekday, minute } = localWeekdayMinute(new Date(floored), timeZone);
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(floored - daysSinceMonday * DAY_MS - minute * MINUTE_MS);
}

export const SettlementStatus = {
  /** Emitida, sin pagos, dentro del plazo. */
  PENDING: "PENDING",
  /** Con pagos parciales, dentro del plazo. */
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  /** Venció con saldo pendiente. */
  OVERDUE: "OVERDUE",
} as const;
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus];

export function settlementStatus(s: { totalMinor: number; paidMinor: number; dueAt: Date }, now: Date): SettlementStatus {
  if (s.paidMinor >= s.totalMinor) return SettlementStatus.PAID;
  if (now.getTime() > s.dueAt.getTime()) return SettlementStatus.OVERDUE;
  return s.paidMinor > 0 ? SettlementStatus.PARTIALLY_PAID : SettlementStatus.PENDING;
}

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  PENDING: "Pendiente",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagada",
  OVERDUE: "Vencida",
};
