import { divideRoundHalfUp, formatARSWhole } from "./money";

/**
 * Promociones del comercio (SPEC §12.4, ADR 0030). Las paga el comercio: la comisión se calcula
 * sobre el subtotal ya descontado (SPEC §6.2, «base comisionable»).
 *
 * - `OFFER`: se aplica sola a todos los pedidos que cumplen.
 * - `COUPON`: hay que ingresar el código en el checkout.
 * No son acumulables: el pedido lleva el mayor descuento.
 */
export const PromotionKind = { OFFER: "OFFER", COUPON: "COUPON" } as const;
export type PromotionKind = (typeof PromotionKind)[keyof typeof PromotionKind];

export const DiscountType = { PERCENT: "PERCENT", FIXED: "FIXED" } as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

/** Límites de una promo: porcentaje entre 1 y 90; un monto fijo, positivo. */
export const MAX_PERCENT_OFF = 90;

export interface PromotionRule {
  discountType: DiscountType;
  /** Porcentaje (1–90) o monto en centavos. */
  value: number;
  /** Productos a los que aplica; `null` = todo el menú. */
  productIds: readonly string[] | null;
  /** Subtotal mínimo del pedido (centavos, antes del descuento). */
  minSubtotalMinor: number;
  /** Tope del descuento para un porcentaje (centavos); `null` = sin tope. */
  maxDiscountMinor: number | null;
}

export interface DiscountLine {
  productId: string;
  /** Total de la línea (precio unitario con opciones × cantidad), en centavos. */
  totalMinor: number;
}

export type DiscountResult =
  | { ok: true; discountMinor: number }
  | { ok: false; reason: "MIN_NOT_MET" | "NO_ELIGIBLE_ITEMS" };

/**
 * Cuánto descuenta la promo en este pedido. Porcentaje con redondeo half-up (la regla única de
 * Pedilo) y nunca más que lo que suman los productos alcanzados ni que el tope.
 */
export function evaluatePromotion(rule: PromotionRule, lines: readonly DiscountLine[]): DiscountResult {
  const subtotal = lines.reduce((s, l) => s + l.totalMinor, 0);
  if (subtotal < rule.minSubtotalMinor) return { ok: false, reason: "MIN_NOT_MET" };
  const scope = rule.productIds ? new Set(rule.productIds) : null;
  const eligible = lines.filter((l) => !scope || scope.has(l.productId)).reduce((s, l) => s + l.totalMinor, 0);
  if (eligible <= 0) return { ok: false, reason: "NO_ELIGIBLE_ITEMS" };

  let discount =
    rule.discountType === DiscountType.PERCENT
      ? Number(divideRoundHalfUp(BigInt(eligible) * BigInt(rule.value), BigInt(100)))
      : rule.value;
  if (rule.discountType === DiscountType.PERCENT && rule.maxDiscountMinor !== null) discount = Math.min(discount, rule.maxDiscountMinor);
  return { ok: true, discountMinor: Math.min(discount, eligible) };
}

/** La que más descuenta entre varias (empate: la primera). `null` si ninguna aplica. */
export function bestPromotion<R extends PromotionRule>(rules: readonly R[], lines: readonly DiscountLine[]): { rule: R; discountMinor: number } | null {
  let best: { rule: R; discountMinor: number } | null = null;
  for (const rule of rules) {
    const r = evaluatePromotion(rule, lines);
    if (r.ok && (!best || r.discountMinor > best.discountMinor)) best = { rule, discountMinor: r.discountMinor };
  }
  return best;
}

/** «20% off», «$2.000 off». */
export function discountLabel(rule: Pick<PromotionRule, "discountType" | "value">): string {
  return rule.discountType === DiscountType.PERCENT ? `${rule.value}% off` : `${formatARSWhole(rule.value)} off`;
}

/**
 * Precio con la oferta aplicada a un producto, para mostrarlo tachado en el menú. Solo cuando no
 * depende del resto del pedido: porcentaje, sin mínimo y alcanzando ese producto. `null` si no.
 */
export function offerUnitPrice(rule: PromotionRule, productId: string, unitPriceMinor: number): number | null {
  if (rule.discountType !== DiscountType.PERCENT || rule.minSubtotalMinor > 0) return null;
  if (rule.productIds && !rule.productIds.includes(productId)) return null;
  const off = Number(divideRoundHalfUp(BigInt(unitPriceMinor) * BigInt(rule.value), BigInt(100)));
  return unitPriceMinor - (rule.maxDiscountMinor !== null ? Math.min(off, rule.maxDiscountMinor) : off);
}

/** Código de cupón normalizado: mayúsculas, sin espacios. */
export const normalizeCouponCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");
