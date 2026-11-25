/** Textos de planes y comisiones (ADR 0012), compartidos por el panel del comercio y el admin. */

export const PLAN_LABELS: Record<"EMPRENDEDOR" | "NEGOCIO" | "PRO", string> = {
  EMPRENDEDOR: "Emprendedor",
  NEGOCIO: "Negocio",
  PRO: "Pro",
};

export const SETTLEMENT_PAYMENT_METHOD_LABELS: Record<"TRANSFER" | "CASH" | "OTHER", string> = {
  TRANSFER: "Transferencia",
  CASH: "Efectivo",
  OTHER: "Otro",
};

export const COMMISSION_ENTRY_LABELS: Record<"ACCRUED" | "ADJUSTMENT", string> = {
  ACCRUED: "Comisión",
  ADJUSTMENT: "Ajuste",
};

/** 400 → "4%", 280 → "2,8%", 250 → "2,5%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`;
}
