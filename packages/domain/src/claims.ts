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
