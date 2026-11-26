import { defineStateMachine } from "./state-machine";

/** Reclamos de soporte de primer nivel. SPEC §11.2. */

export const ClaimReason = {
  MISSING_ITEM: "MISSING_ITEM",
  WRONG_ITEM: "WRONG_ITEM",
  QUALITY: "QUALITY",
  DELAY: "DELAY",
  NOT_DELIVERED: "NOT_DELIVERED",
  WRONG_CHARGE: "WRONG_CHARGE",
} as const;
export type ClaimReason = (typeof ClaimReason)[keyof typeof ClaimReason];

export const ClaimStatus = {
  OPEN: "OPEN",
  MERCHANT_REVIEW: "MERCHANT_REVIEW",
  AGREED_REFUND: "AGREED_REFUND",
  PAYMENT_REFUND_PENDING: "PAYMENT_REFUND_PENDING",
  RESOLVED: "RESOLVED",
  DISPUTED: "DISPUTED",
  ESCALATED: "ESCALATED",
  CLOSED: "CLOSED",
} as const;
export type ClaimStatus = (typeof ClaimStatus)[keyof typeof ClaimStatus];

const S = ClaimStatus;

export const claimStateMachine = defineStateMachine<ClaimStatus>("claim", {
  // Primero propone solución el comercio; Pedilo escala si no responde o hay casos graves.
  [S.OPEN]: [S.MERCHANT_REVIEW, S.ESCALATED],
  [S.MERCHANT_REVIEW]: [S.AGREED_REFUND, S.RESOLVED, S.DISPUTED, S.ESCALATED],
  // Efectivo: el reembolso se registra con comprobante y pasa directo a RESOLVED.
  [S.AGREED_REFUND]: [S.PAYMENT_REFUND_PENDING, S.RESOLVED],
  [S.PAYMENT_REFUND_PENDING]: [S.RESOLVED, S.ESCALATED],
  [S.DISPUTED]: [S.ESCALATED, S.RESOLVED],
  [S.ESCALATED]: [S.RESOLVED, S.CLOSED],
  [S.RESOLVED]: [S.CLOSED],
  [S.CLOSED]: [],
});

// ---------------------------------------------------------------------------
// Reglas del MVP (ADR 0019)
// ---------------------------------------------------------------------------

export const CLAIM_REASON_LABELS: Record<ClaimReason, string> = {
  MISSING_ITEM: "Faltó algo",
  WRONG_ITEM: "Vino algo distinto",
  QUALITY: "Problema de calidad",
  DELAY: "Llegó muy tarde",
  NOT_DELIVERED: "No me llegó",
  WRONG_CHARGE: "Me cobraron mal",
};

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  OPEN: "Esperando respuesta del comercio",
  MERCHANT_REVIEW: "El comercio propuso una solución",
  AGREED_REFUND: "Devolución acordada",
  PAYMENT_REFUND_PENDING: "Devolución en proceso",
  RESOLVED: "Resuelto",
  DISPUTED: "En desacuerdo",
  ESCALATED: "Lo revisa Pedilo",
  CLOSED: "Cerrado",
};

/** Lo que puede proponer el comercio (SPEC §11.2). */
export const ClaimResolutionType = {
  REFUND_FULL: "REFUND_FULL",
  REFUND_PARTIAL: "REFUND_PARTIAL",
  RESEND: "RESEND",
  REPLACE: "REPLACE",
  REJECT: "REJECT",
} as const;
export type ClaimResolutionType = (typeof ClaimResolutionType)[keyof typeof ClaimResolutionType];

export const CLAIM_RESOLUTION_LABELS: Record<ClaimResolutionType, string> = {
  REFUND_FULL: "Devolución total",
  REFUND_PARTIAL: "Devolución parcial",
  RESEND: "Reenvío",
  REPLACE: "Reemplazo",
  REJECT: "Rechazo",
};

export const isRefundResolution = (t: ClaimResolutionType) => t === ClaimResolutionType.REFUND_FULL || t === ClaimResolutionType.REFUND_PARTIAL;

/** Ventana para reclamar desde que el pedido terminó. */
export const CLAIM_WINDOW_HOURS = 48;
/** Plazo del comercio para proponer una solución; vencido, se escala a Pedilo. */
export const MERCHANT_CLAIM_SLA_HOURS = 24;

/** Estados en los que el reclamo todavía espera a alguien. */
export const isClaimOpen = (s: ClaimStatus) => s !== ClaimStatus.RESOLVED && s !== ClaimStatus.CLOSED;
