import { describe, expect, it } from "vitest";

import { divideRoundHalfUp, formatARS, pesos } from "./money";

describe("money", () => {
  it("pesos → centavos", () => {
    expect(pesos(30_000)).toBe(3_000_000);
    expect(pesos(0.1)).toBe(10);
  });

  it("redondeo half-up", () => {
    expect(divideRoundHalfUp(BigInt(5), BigInt(10))).toBe(BigInt(1)); // 0,5 → 1
    expect(divideRoundHalfUp(BigInt(4), BigInt(10))).toBe(BigInt(0)); // 0,4 → 0
    expect(divideRoundHalfUp(BigInt(15), BigInt(10))).toBe(BigInt(2)); // 1,5 → 2
    expect(divideRoundHalfUp(BigInt(0), BigInt(10))).toBe(BigInt(0));
  });

  it("formato en pesos argentinos", () => {
    expect(formatARS(348_000)).toBe("$ 3.480,00");
    expect(formatARS(5)).toBe("$ 0,05");
    expect(formatARS(123_456_789)).toBe("$ 1.234.567,89");
    expect(formatARS(-150)).toBe("-$ 1,50");
  });
});
