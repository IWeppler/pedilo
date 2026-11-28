import { describe, expect, it } from "vitest";

import { nextOpening } from "./schedule";

const TZ = "America/Argentina/Buenos_Aires";
// Lunes a sábado 11:00–14:00 y 20:00–00:30 (cruza la medianoche). Domingo cerrado.
const ranges = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
  { weekday, opensAt: 11 * 60, closesAt: 14 * 60 },
  { weekday, opensAt: 20 * 60, closesAt: 30 },
]);
// 2026-11-30 es lunes. Argentina es UTC-3.
const at = (iso: string) => new Date(`${iso}-03:00`);

describe("nextOpening (ADR 0029)", () => {
  it("hoy más tarde: en la siesta abre a las 20:00", () => {
    expect(nextOpening(ranges, [], TZ, at("2026-11-30T16:00:00"))).toEqual({ inDays: 0, weekday: 1, time: "20:00" });
  });

  it("antes de abrir, el primer turno del día", () => {
    expect(nextOpening(ranges, [], TZ, at("2026-11-30T08:00:00"))).toEqual({ inDays: 0, weekday: 1, time: "11:00" });
  });

  it("de noche, mañana; el sábado a la noche salta el domingo cerrado", () => {
    expect(nextOpening(ranges, [], TZ, at("2026-11-30T23:00:00"))).toEqual({ inDays: 1, weekday: 2, time: "11:00" });
    expect(nextOpening(ranges, [], TZ, at("2026-12-05T21:00:00"))).toEqual({ inDays: 2, weekday: 1, time: "11:00" });
  });

  it("saltea los cierres excepcionales y devuelve null si no abre en la semana", () => {
    const feriado = [{ startsOn: "2026-12-01", endsOn: "2026-12-01", reason: "Feriado" }];
    expect(nextOpening(ranges, feriado, TZ, at("2026-11-30T23:00:00"))).toEqual({ inDays: 2, weekday: 3, time: "11:00" });
    const vacaciones = [{ startsOn: "2026-11-30", endsOn: "2026-12-20", reason: "Vacaciones" }];
    expect(nextOpening(ranges, vacaciones, TZ, at("2026-11-30T08:00:00"))).toBeNull();
    expect(nextOpening([], [], TZ, at("2026-11-30T08:00:00"))).toBeNull();
  });
});
