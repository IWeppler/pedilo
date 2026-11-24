/**
 * Dinero en unidades menores (centavos), siempre enteros. SPEC §8.5 y §15.
 * Nunca usar decimales de punto flotante para importes.
 */
export type MinorUnits = number;

/** Puntos básicos: 10.000 bps = 100%. 400 bps = 4%. */
export type BasisPoints = number;

export const CURRENCY = "ARS" as const;
export type Currency = typeof CURRENCY;

export function isMinorUnits(value: unknown): value is MinorUnits {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertMinorUnits(value: number, field = "importe"): asserts value is MinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} debe ser un entero en centavos; recibido ${value}`);
  }
}

export function assertNonNegativeMinorUnits(value: number, field = "importe"): void {
  assertMinorUnits(value, field);
  if (value < 0) throw new RangeError(`${field} no puede ser negativo; recibido ${value}`);
}

/** Convierte pesos enteros a centavos. Para literales de configuración y tests. */
export function pesos(amount: number): MinorUnits {
  const minor = Math.round(amount * 100);
  assertMinorUnits(minor);
  return minor;
}

// Sin literales `0n`: así el paquete compila aunque quien lo importe apunte a un target < ES2020.
const ZERO = BigInt(0);
const TWO = BigInt(2);

/**
 * División entera con redondeo "half-up" (0,5 centavos se redondea hacia arriba).
 * Es la regla única de redondeo de Pedilo (SPEC §6.2). Solo para valores no negativos.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < ZERO || denominator <= ZERO) {
    throw new RangeError("divideRoundHalfUp espera numerador ≥ 0 y denominador > 0");
  }
  return (numerator * TWO + denominator) / (denominator * TWO);
}

/** Formatea centavos como pesos argentinos, p. ej. 348000 → "$ 3.480,00". */
export function formatARS(minor: MinorUnits): string {
  assertMinorUnits(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const intPart = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cents = (abs % 100).toString().padStart(2, "0");
  return `${sign}$ ${intPart},${cents}`;
}
