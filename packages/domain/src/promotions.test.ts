import { describe, expect, it } from "vitest";

import { bestPromotion, discountLabel, evaluatePromotion, normalizeCouponCode, offerUnitPrice, type PromotionRule } from "./promotions";

const lines = [
  { productId: "pizza", totalMinor: 1_800_000 }, // 2 pizzas de $9.000
  { productId: "coca", totalMinor: 300_000 },
];
const rule = (r: Partial<PromotionRule>): PromotionRule => ({
  discountType: "PERCENT",
  value: 10,
  productIds: null,
  minSubtotalMinor: 0,
  maxDiscountMinor: null,
  ...r,
});

describe("promociones (ADR 0030)", () => {
  it("porcentaje sobre todo el pedido, con redondeo half-up", () => {
    expect(evaluatePromotion(rule({ value: 10 }), lines)).toEqual({ ok: true, discountMinor: 210_000 });
    // 33% de $21.000 = $6.930
    expect(evaluatePromotion(rule({ value: 33 }), lines)).toEqual({ ok: true, discountMinor: 693_000 });
    expect(evaluatePromotion(rule({ value: 15 }), [{ productId: "x", totalMinor: 333 }])).toEqual({ ok: true, discountMinor: 50 });
  });

  it("solo los productos alcanzados; con tope", () => {
    expect(evaluatePromotion(rule({ value: 20, productIds: ["pizza"] }), lines)).toEqual({ ok: true, discountMinor: 360_000 });
    expect(evaluatePromotion(rule({ value: 20, productIds: ["pizza"], maxDiscountMinor: 200_000 }), lines)).toEqual({ ok: true, discountMinor: 200_000 });
    expect(evaluatePromotion(rule({ productIds: ["empanada"] }), lines)).toEqual({ ok: false, reason: "NO_ELIGIBLE_ITEMS" });
  });

  it("monto fijo, nunca más que lo alcanzado; mínimo sobre el subtotal", () => {
    expect(evaluatePromotion(rule({ discountType: "FIXED", value: 200_000 }), lines)).toEqual({ ok: true, discountMinor: 200_000 });
    expect(evaluatePromotion(rule({ discountType: "FIXED", value: 500_000, productIds: ["coca"] }), lines)).toEqual({ ok: true, discountMinor: 300_000 });
    expect(evaluatePromotion(rule({ minSubtotalMinor: 2_100_000 }), lines).ok).toBe(true);
    expect(evaluatePromotion(rule({ minSubtotalMinor: 2_100_001 }), lines)).toEqual({ ok: false, reason: "MIN_NOT_MET" });
  });

  it("la mejor de varias", () => {
    const a = rule({ value: 10 });
    const b = rule({ discountType: "FIXED", value: 300_000 });
    const c = rule({ value: 50, minSubtotalMinor: 5_000_000 });
    expect(bestPromotion([a, b, c], lines)).toEqual({ rule: b, discountMinor: 300_000 });
    expect(bestPromotion([c], lines)).toBeNull();
  });

  it("etiqueta, precio tachado y código", () => {
    expect(discountLabel(rule({ value: 20 }))).toBe("20% off");
    expect(discountLabel(rule({ discountType: "FIXED", value: 200_000 }))).toBe("$ 2.000 off");
    expect(offerUnitPrice(rule({ value: 20 }), "pizza", 900_000)).toBe(720_000);
    expect(offerUnitPrice(rule({ value: 20, productIds: ["coca"] }), "pizza", 900_000)).toBeNull();
    expect(offerUnitPrice(rule({ value: 20, minSubtotalMinor: 1 }), "pizza", 900_000)).toBeNull();
    expect(offerUnitPrice(rule({ discountType: "FIXED", value: 100 }), "pizza", 900_000)).toBeNull();
    expect(normalizeCouponCode(" pizza 10 ")).toBe("PIZZA10");
  });
});
