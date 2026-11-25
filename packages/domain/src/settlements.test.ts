import { describe, expect, it } from "vitest";

import { lastWeeklyCutoff, settlementStatus } from "./settlements";

const tz = "America/Argentina/Buenos_Aires"; // UTC-3

describe("lastWeeklyCutoff", () => {
  it("devuelve el lunes 00:00 local anterior", () => {
    // Miércoles 2026-11-25 15:42 local (18:42 UTC) → lunes 2026-11-23 00:00 local = 03:00 UTC.
    expect(lastWeeklyCutoff(new Date("2026-11-25T18:42:37Z"), tz).toISOString()).toBe("2026-11-23T03:00:00.000Z");
  });

  it("domingo 23:59 local todavía es la semana anterior; lunes 00:00 es el corte nuevo", () => {
    expect(lastWeeklyCutoff(new Date("2026-11-30T02:59:00Z"), tz).toISOString()).toBe("2026-11-23T03:00:00.000Z");
    expect(lastWeeklyCutoff(new Date("2026-11-30T03:00:00Z"), tz).toISOString()).toBe("2026-11-30T03:00:00.000Z");
  });

  it("usa la hora local, no UTC: lunes 01:00 UTC es todavía domingo en Argentina", () => {
    expect(lastWeeklyCutoff(new Date("2026-11-30T01:00:00Z"), tz).toISOString()).toBe("2026-11-23T03:00:00.000Z");
  });
});

describe("settlementStatus", () => {
  const dueAt = new Date("2026-12-07T03:00:00Z");
  const before = new Date("2026-12-01T00:00:00Z");
  const after = new Date("2026-12-08T00:00:00Z");

  it("pendiente, parcial, pagada y vencida", () => {
    expect(settlementStatus({ totalMinor: 1000, paidMinor: 0, dueAt }, before)).toBe("PENDING");
    expect(settlementStatus({ totalMinor: 1000, paidMinor: 400, dueAt }, before)).toBe("PARTIALLY_PAID");
    expect(settlementStatus({ totalMinor: 1000, paidMinor: 1000, dueAt }, after)).toBe("PAID");
    expect(settlementStatus({ totalMinor: 1000, paidMinor: 400, dueAt }, after)).toBe("OVERDUE");
    expect(settlementStatus({ totalMinor: 1000, paidMinor: 0, dueAt }, after)).toBe("OVERDUE");
  });
});
