import { describe, expect, it } from "vitest";

import { canRateUntil, publicRating, summarizeRatings } from "./ratings";

describe("calificaciones (ADR 0031)", () => {
  it("promedio con un decimal, half-up, y distribución", () => {
    expect(summarizeRatings([5, 4, 5, 5, 4])).toEqual({ average: 4.6, count: 5, distribution: [0, 0, 0, 2, 3] });
    // 4,25 → 4,3
    expect(summarizeRatings([5, 4, 4, 4])!.average).toBe(4.3);
    expect(summarizeRatings([1])).toEqual({ average: 1, count: 1, distribution: [1, 0, 0, 0, 0] });
    expect(summarizeRatings([])).toBeNull();
  });

  it("público recién con 5 calificaciones", () => {
    expect(publicRating(summarizeRatings([5, 5, 5, 5]))).toBeNull();
    expect(publicRating(summarizeRatings([5, 5, 5, 5, 3]))).toEqual({ average: 4.6, count: 5 });
    expect(publicRating(null)).toBeNull();
  });

  it("plazo de 14 días", () => {
    expect(canRateUntil(new Date("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-11-15T12:00:00.000Z");
  });
});
