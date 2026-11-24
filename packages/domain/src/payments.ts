import { defineStateMachine } from "./state-machine";

/** Pagos. SPEC §8. Máquina independiente del estado del pedido. */

export const PaymentMethod = {
  MERCADO_PAGO: "MERCADO_PAGO",
  CASH: "CASH",
  TRANSFER: "TRANSFER",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/** Quién recibe físicamente el efectivo (SPEC §8.3). */
export const CashCollector = {
  MERCHANT: "MERCHANT",
  COURIER: "COURIER",
} as const;
export type CashCollector = (typeof CashCollector)[keyof typeof CashCollector];

export const PaymentStatus = {
  /** Digital: esperando confirmación del PSP. Efectivo/transferencia: esperando que el comercio confirme recepción. */
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  /** Cancelado antes de aprobarse. No es un reembolso. */
  CANCELLED: "CANCELLED",
  REFUND_PENDING: "REFUND_PENDING",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  REFUNDED: "REFUNDED",
  /** El PSP rechazó el reembolso (p. ej. saldo insuficiente del comercio). */
  REFUND_BLOCKED: "REFUND_BLOCKED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  CHARGEBACK: "CHARGEBACK",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

const S = PaymentStatus;

export const paymentStateMachine = defineStateMachine<PaymentStatus>("payment", {
  [S.PENDING]: [S.APPROVED, S.REJECTED, S.CANCELLED],
  [S.APPROVED]: [S.REFUND_PENDING, S.CHARGEBACK],
  // Un 2xx del PSP no alcanza: se queda en REFUND_PENDING hasta confirmar el estado final.
  [S.REFUND_PENDING]: [S.REFUNDED, S.PARTIALLY_REFUNDED, S.REFUND_BLOCKED],
  // Se admiten nuevos reembolsos parciales hasta agotar el saldo reembolsable.
  [S.PARTIALLY_REFUNDED]: [S.REFUND_PENDING, S.CHARGEBACK],
  [S.REFUND_BLOCKED]: [S.REFUND_PENDING, S.MANUAL_REVIEW],
  [S.MANUAL_REVIEW]: [S.REFUND_PENDING, S.REFUNDED, S.PARTIALLY_REFUNDED],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
  [S.REFUNDED]: [],
  [S.CHARGEBACK]: [],
});

/** Estado inicial según medio: todos arrancan pendientes; ninguno se marca cobrado automáticamente. */
export function initialPaymentStatus(_method: PaymentMethod): PaymentStatus {
  return S.PENDING;
}
