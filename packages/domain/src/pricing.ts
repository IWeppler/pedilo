import {
  assertNonNegativeMinorUnits,
  type BasisPoints,
  divideRoundHalfUp,
  type MinorUnits,
  pesos,
} from "./money";

/**
 * Comisión Pedilo por tramos marginales con tope por rubro. SPEC §6.2.
 *
 * - Cada tramo aplica un porcentaje de la tasa base del plan SOLO sobre el excedente
 *   dentro de ese tramo (nunca retroactivo al pedido completo).
 * - Luego se aplica el tope del rubro: commission = min(por_tramos, tope).
 * - Se redondea UNA sola vez al final, half-up al centavo.
 *
 * Todos los valores son parámetros versionados (`PricingVersion`). Los de
 * `LAUNCH_PRICING_HYPOTHESIS` son la hipótesis comercial v0.4, no precios aprobados.
 */

export const MerchantCategory = {
  GASTRONOMY: "GASTRONOMY",
  KIOSK: "KIOSK",
  SUPERMARKET: "SUPERMARKET",
  ELECTRONICS: "ELECTRONICS",
  ENTREPRENEUR: "ENTREPRENEUR",
} as const;
export type MerchantCategory = (typeof MerchantCategory)[keyof typeof MerchantCategory];

export const PlanCode = {
  EMPRENDEDOR: "EMPRENDEDOR",
  NEGOCIO: "NEGOCIO",
  PRO: "PRO",
} as const;
export type PlanCode = (typeof PlanCode)[keyof typeof PlanCode];

export interface CommissionBracket {
  /** Límite superior del tramo (inclusive), en centavos. `null` = sin límite. */
  readonly upToMinor: MinorUnits | null;
  /** Porción de la tasa base que aplica en este tramo. 10.000 = 100%. */
  readonly rateFactorBps: BasisPoints;
}

export interface PlanTerms {
  readonly monthlyFeeMinor: MinorUnits;
  readonly baseRateBps: BasisPoints;
  readonly maxBranches: number;
  readonly maxUsers: number;
}

export interface PricingVersion {
  readonly id: string;
  readonly brackets: readonly CommissionBracket[];
  readonly capsByCategory: { readonly [C in MerchantCategory]: MinorUnits };
  readonly plans: { readonly [P in PlanCode]: PlanTerms };
}

export const LAUNCH_PRICING_HYPOTHESIS: PricingVersion = {
  id: "v0.4-hypothesis",
  brackets: [
    { upToMinor: pesos(30_000), rateFactorBps: 10_000 },
    { upToMinor: pesos(100_000), rateFactorBps: 7_000 },
    { upToMinor: null, rateFactorBps: 4_000 },
  ],
  capsByCategory: {
    GASTRONOMY: pesos(5_000),
    KIOSK: pesos(4_000),
    SUPERMARKET: pesos(5_000),
    ELECTRONICS: pesos(7_000),
    ENTREPRENEUR: pesos(5_000),
  },
  plans: {
    EMPRENDEDOR: { monthlyFeeMinor: 0, baseRateBps: 600, maxBranches: 1, maxUsers: 1 },
    NEGOCIO: { monthlyFeeMinor: pesos(25_000), baseRateBps: 400, maxBranches: 1, maxUsers: 3 },
    PRO: { monthlyFeeMinor: pesos(60_000), baseRateBps: 250, maxBranches: 3, maxUsers: 6 },
  },
};

export interface CommissionInput {
  /**
   * Base comisionable en centavos: subtotal de productos después de descuentos financiados
   * por el comercio, antes de envío, propina y descuentos financiados por Pedilo.
   */
  readonly basisMinor: MinorUnits;
  readonly baseRateBps: BasisPoints;
  readonly category: MerchantCategory;
  readonly pricing: PricingVersion;
}

export interface CommissionBracketDetail {
  readonly fromMinor: MinorUnits;
  readonly toMinor: MinorUnits;
  readonly amountMinor: MinorUnits;
  readonly effectiveRateBps: number;
}

export interface CommissionResult {
  readonly pricingVersionId: string;
  readonly commissionMinor: MinorUnits;
  /** Comisión por tramos antes de aplicar el tope. */
  readonly uncappedMinor: MinorUnits;
  readonly capMinor: MinorUnits;
  readonly capApplied: boolean;
  readonly brackets: readonly CommissionBracketDetail[];
}

const BPS_SQUARED = BigInt(10_000) * BigInt(10_000);

export function calculateCommission(input: CommissionInput): CommissionResult {
  const { basisMinor, baseRateBps, category, pricing } = input;
  assertNonNegativeMinorUnits(basisMinor, "basisMinor");
  if (!Number.isSafeInteger(baseRateBps) || baseRateBps < 0) {
    throw new RangeError(`baseRateBps inválido: ${baseRateBps}`);
  }
  validateBrackets(pricing.brackets);

  // Acumula en BigInt el numerador exacto (centavos × bps × bps) y redondea una sola vez.
  let numerator = BigInt(0);
  let lower = 0;
  const details: CommissionBracketDetail[] = [];

  for (const bracket of pricing.brackets) {
    if (basisMinor <= lower) break;
    const upper = bracket.upToMinor === null ? basisMinor : Math.min(basisMinor, bracket.upToMinor);
    const amount = upper - lower;
    if (amount > 0) {
      numerator += BigInt(amount) * BigInt(baseRateBps) * BigInt(bracket.rateFactorBps);
      details.push({
        fromMinor: lower,
        toMinor: upper,
        amountMinor: amount,
        effectiveRateBps: (baseRateBps * bracket.rateFactorBps) / 10_000,
      });
    }
    lower = upper;
  }

  const uncappedMinor = Number(divideRoundHalfUp(numerator, BPS_SQUARED));
  const capMinor = pricing.capsByCategory[category];
  const capApplied = uncappedMinor > capMinor;

  return {
    pricingVersionId: pricing.id,
    commissionMinor: capApplied ? capMinor : uncappedMinor,
    uncappedMinor,
    capMinor,
    capApplied,
    brackets: details,
  };
}

/** Atajo: comisión para un plan de una versión de pricing. */
export function calculatePlanCommission(
  basisMinor: MinorUnits,
  plan: PlanCode,
  category: MerchantCategory,
  pricing: PricingVersion = LAUNCH_PRICING_HYPOTHESIS,
): CommissionResult {
  return calculateCommission({
    basisMinor,
    baseRateBps: pricing.plans[plan].baseRateBps,
    category,
    pricing,
  });
}

function validateBrackets(brackets: readonly CommissionBracket[]): void {
  if (brackets.length === 0) throw new RangeError("La versión de pricing no tiene tramos");
  let previous = 0;
  brackets.forEach((b, i) => {
    const isLast = i === brackets.length - 1;
    if (b.upToMinor === null && !isLast) {
      throw new RangeError("Solo el último tramo puede no tener límite");
    }
    if (b.upToMinor !== null) {
      if (b.upToMinor <= previous) throw new RangeError("Los tramos deben ser crecientes");
      previous = b.upToMinor;
    }
    if (isLast && b.upToMinor !== null) {
      throw new RangeError("El último tramo debe ser sin límite (upToMinor: null)");
    }
  });
}
