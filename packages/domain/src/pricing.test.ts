import { describe, expect, it } from "vitest";

import { pesos } from "./money";
import {
  calculateCommission,
  calculatePlanCommission,
  LAUNCH_PRICING_HYPOTHESIS,
  MerchantCategory,
  PlanCode,
  type PricingVersion,
} from "./pricing";

const { NEGOCIO, EMPRENDEDOR, PRO } = PlanCode;
const { SUPERMARKET, KIOSK, ELECTRONICS } = MerchantCategory;

describe("calculateCommission — ejemplo del SPEC §6.2", () => {
  it("plan Negocio, supermercado, pedido $120.000 → $3.480", () => {
    const r = calculatePlanCommission(pesos(120_000), NEGOCIO, SUPERMARKET);
    expect(r.commissionMinor).toBe(pesos(3_480));
    expect(r.capApplied).toBe(false);
    expect(r.brackets.map((b) => [b.amountMinor, b.effectiveRateBps])).toEqual([
      [pesos(30_000), 400],
      [pesos(70_000), 280],
      [pesos(20_000), 160],
    ]);
    expect(r.pricingVersionId).toBe(LAUNCH_PRICING_HYPOTHESIS.id);
  });
});

describe("calculateCommission — bordes de tramo (SPEC §6.2)", () => {
  // Plan Negocio (4%). Valores esperados calculados a mano, half-up al centavo.
  const cases: Array<[string, number, number]> = [
    ["$0", 0, 0],
    ["$29.999,99", 2_999_999, 120_000], // 119.999,96 → 120.000
    ["$30.000", 3_000_000, 120_000],
    ["$30.000,01", 3_000_001, 120_000], // 120.000 + 0,028 → 120.000
    ["$99.999,99", 9_999_999, 316_000], // 120.000 + 6.999.999×0,028 = 315.999,972 → 316.000
    ["$100.000", 10_000_000, 316_000],
    ["$100.000,01", 10_000_001, 316_000], // + 0,016 → 316.000
  ];

  it.each(cases)("%s", (_label, basis, expected) => {
    expect(calculatePlanCommission(basis, NEGOCIO, ELECTRONICS).commissionMinor).toBe(expected);
  });

  it("la tasa reducida no es retroactiva: el primer tramo siempre paga la tasa completa", () => {
    const small = calculatePlanCommission(pesos(30_000), NEGOCIO, ELECTRONICS);
    const big = calculatePlanCommission(pesos(30_001), NEGOCIO, ELECTRONICS);
    expect(big.commissionMinor).toBeGreaterThanOrEqual(small.commissionMinor);
  });

  it("la comisión nunca baja cuando sube la base (monotonía)", () => {
    let previous = 0;
    for (let basis = 0; basis <= pesos(300_000); basis += 12_345) {
      const c = calculatePlanCommission(basis, EMPRENDEDOR, ELECTRONICS).commissionMinor;
      expect(c).toBeGreaterThanOrEqual(previous);
      previous = c;
    }
  });
});

describe("calculateCommission — topes por rubro", () => {
  it("aplica el tope exacto cuando la comisión por tramos lo supera", () => {
    // Emprendedor 6% en kiosco: tope $4.000. $30.000×6% = $1.800; $70.000×4,2% = $2.940 → ya supera.
    const r = calculatePlanCommission(pesos(100_000), EMPRENDEDOR, KIOSK);
    expect(r.uncappedMinor).toBe(pesos(4_740));
    expect(r.commissionMinor).toBe(pesos(4_000));
    expect(r.capApplied).toBe(true);
  });

  it("comisión igual al tope no se marca como tope aplicado", () => {
    const pricing: PricingVersion = {
      ...LAUNCH_PRICING_HYPOTHESIS,
      capsByCategory: { ...LAUNCH_PRICING_HYPOTHESIS.capsByCategory, SUPERMARKET: pesos(3_480) },
    };
    const r = calculatePlanCommission(pesos(120_000), NEGOCIO, SUPERMARKET, pricing);
    expect(r.commissionMinor).toBe(pesos(3_480));
    expect(r.capApplied).toBe(false);
  });

  it("plan Pro con ticket muy alto queda en el tope", () => {
    const r = calculatePlanCommission(pesos(1_000_000), PRO, SUPERMARKET);
    expect(r.commissionMinor).toBe(pesos(5_000));
  });
});

describe("calculateCommission — validaciones", () => {
  it("rechaza importes no enteros o negativos", () => {
    expect(() => calculatePlanCommission(100.5, NEGOCIO, KIOSK)).toThrow(RangeError);
    expect(() => calculatePlanCommission(-1, NEGOCIO, KIOSK)).toThrow(RangeError);
  });

  it("rechaza tramos mal configurados", () => {
    const bad: PricingVersion = {
      ...LAUNCH_PRICING_HYPOTHESIS,
      brackets: [
        { upToMinor: pesos(100_000), rateFactorBps: 10_000 },
        { upToMinor: pesos(30_000), rateFactorBps: 7_000 },
        { upToMinor: null, rateFactorBps: 4_000 },
      ],
    };
    expect(() =>
      calculateCommission({ basisMinor: 1, baseRateBps: 400, category: KIOSK, pricing: bad }),
    ).toThrow(/crecientes/);
  });

  it("no pierde precisión con importes grandes", () => {
    const pricing: PricingVersion = {
      ...LAUNCH_PRICING_HYPOTHESIS,
      capsByCategory: { ...LAUNCH_PRICING_HYPOTHESIS.capsByCategory, ELECTRONICS: Number.MAX_SAFE_INTEGER },
    };
    // $1.000.000.000 en plan Negocio: 1.200 + 1.960 + 999.900.000×1,6% (15.998.400) = 16.001.560
    const r = calculatePlanCommission(pesos(1_000_000_000), NEGOCIO, ELECTRONICS, pricing);
    expect(r.commissionMinor).toBe(pesos(16_001_560));
  });
});
