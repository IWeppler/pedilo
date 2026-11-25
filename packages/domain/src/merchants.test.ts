import { describe, expect, it } from "vitest";

import {
  type BranchReadiness,
  canEditFullProfile,
  merchantStateMachine,
  MerchantStatus,
  OnboardingIssue,
  onboardingProblems,
} from "./merchants";
import {
  formatTime,
  isOpenAt,
  isSchedulableSlot,
  localWeekdayMinute,
  parseTime,
  scheduleSlots,
  ScheduleError,
  validateSchedule,
} from "./schedule";

const branch = (over: Partial<BranchReadiness> = {}): BranchReadiness => ({
  id: "b1",
  active: true,
  hoursCount: 7,
  acceptsPickup: true,
  acceptsDelivery: false,
  activeZonesCount: 0,
  ...over,
});

describe("estado del comercio", () => {
  it("un borrador solo puede enviarse a revisión", () => {
    expect(merchantStateMachine.next(MerchantStatus.DRAFT)).toEqual([MerchantStatus.PENDING_REVIEW]);
  });

  it("un rechazado vuelve a revisión; un aprobado no vuelve a borrador", () => {
    expect(merchantStateMachine.canTransition(MerchantStatus.REJECTED, MerchantStatus.PENDING_REVIEW)).toBe(true);
    expect(merchantStateMachine.canTransition(MerchantStatus.APPROVED, MerchantStatus.DRAFT)).toBe(false);
  });

  it("solo se edita el perfil completo antes de la aprobación", () => {
    expect(canEditFullProfile(MerchantStatus.DRAFT)).toBe(true);
    expect(canEditFullProfile(MerchantStatus.REJECTED)).toBe(true);
    expect(canEditFullProfile(MerchantStatus.PENDING_REVIEW)).toBe(false);
    expect(canEditFullProfile(MerchantStatus.APPROVED)).toBe(false);
  });
});

describe("checklist de onboarding", () => {
  it("sin sucursales activas", () => {
    expect(onboardingProblems([])).toEqual([{ issue: OnboardingIssue.NO_ACTIVE_BRANCH }]);
    expect(onboardingProblems([branch({ active: false })])).toEqual([{ issue: OnboardingIssue.NO_ACTIVE_BRANCH }]);
  });

  it("sucursal completa con retiro → listo", () => {
    expect(onboardingProblems([branch()])).toEqual([]);
  });

  it("sin horarios", () => {
    expect(onboardingProblems([branch({ hoursCount: 0 })])).toEqual([
      { issue: OnboardingIssue.BRANCH_WITHOUT_HOURS, branchId: "b1" },
    ]);
  });

  it("envío sin zonas y sin retiro no alcanza; con una zona activa sí", () => {
    const noZones = branch({ acceptsPickup: false, acceptsDelivery: true, activeZonesCount: 0 });
    expect(onboardingProblems([noZones])).toEqual([
      { issue: OnboardingIssue.BRANCH_WITHOUT_FULFILLMENT, branchId: "b1" },
    ]);
    expect(onboardingProblems([{ ...noZones, activeZonesCount: 1 }])).toEqual([]);
  });

  it("las sucursales inactivas no cuentan", () => {
    expect(onboardingProblems([branch(), branch({ id: "b2", active: false, hoursCount: 0 })])).toEqual([]);
  });
});

describe("horarios", () => {
  it("parse y formato de horas", () => {
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("24:00")).toBe(1440);
    expect(parseTime("24:30")).toBeNull();
    expect(parseTime("9:30")).toBeNull();
    expect(formatTime(570)).toBe("09:30");
    expect(formatTime(1440)).toBe("24:00");
  });

  it("horario de corrido y cortado en el mismo día es válido", () => {
    expect(
      validateSchedule([
        { weekday: 1, opensAt: 480, closesAt: 780 },
        { weekday: 1, opensAt: 1020, closesAt: 1320 },
      ]),
    ).toEqual([]);
  });

  it("un rango que cruza la medianoche es válido", () => {
    expect(validateSchedule([{ weekday: 5, opensAt: 1200, closesAt: 60 }])).toEqual([]);
  });

  it("rangos superpuestos en el mismo día", () => {
    expect(
      validateSchedule([
        { weekday: 2, opensAt: 480, closesAt: 780 },
        { weekday: 2, opensAt: 720, closesAt: 900 },
      ]),
    ).toEqual([{ error: ScheduleError.OVERLAP, index: 1 }]);
  });

  it("un rango nocturno se superpone con uno posterior del mismo día", () => {
    expect(
      validateSchedule([
        { weekday: 6, opensAt: 1200, closesAt: 60 },
        { weekday: 6, opensAt: 1300, closesAt: 1400 },
      ]),
    ).toEqual([{ error: ScheduleError.OVERLAP, index: 1 }]);
  });

  it("errores de día, hora y rango vacío", () => {
    expect(
      validateSchedule([
        { weekday: 7, opensAt: 0, closesAt: 60 },
        { weekday: 1, opensAt: -1, closesAt: 60 },
        { weekday: 1, opensAt: 600, closesAt: 600 },
      ]),
    ).toEqual([
      { error: ScheduleError.INVALID_WEEKDAY, index: 0 },
      { error: ScheduleError.INVALID_TIME, index: 1 },
      { error: ScheduleError.EMPTY_RANGE, index: 2 },
    ]);
  });
});


describe("abierto ahora", () => {
  const ranges = [
    { weekday: 1, opensAt: 540, closesAt: 780 }, // lunes 09:00–13:00
    { weekday: 5, opensAt: 1200, closesAt: 60 }, // viernes 20:00–01:00
    { weekday: 0, opensAt: 1200, closesAt: 1440 }, // domingo 20:00–24:00
  ];

  it("dentro y fuera de un rango simple (el cierre es exclusivo)", () => {
    expect(isOpenAt(ranges, 1, 540)).toBe(true);
    expect(isOpenAt(ranges, 1, 779)).toBe(true);
    expect(isOpenAt(ranges, 1, 780)).toBe(false);
    expect(isOpenAt(ranges, 1, 539)).toBe(false);
  });

  it("un rango nocturno cubre el día siguiente hasta el cierre", () => {
    expect(isOpenAt(ranges, 5, 1439)).toBe(true);
    expect(isOpenAt(ranges, 6, 30)).toBe(true);
    expect(isOpenAt(ranges, 6, 60)).toBe(false);
  });

  it("cierre a medianoche (24:00) no se extiende al lunes", () => {
    expect(isOpenAt(ranges, 0, 1439)).toBe(true);
    expect(isOpenAt(ranges, 1, 0)).toBe(false);
  });

  it("hora local en Argentina (UTC−3)", () => {
    // 2026-11-27 (viernes) 23:30 UTC = 20:30 en Argentina.
    expect(localWeekdayMinute(new Date("2026-11-27T23:30:00Z"), "America/Argentina/Cordoba")).toEqual({
      weekday: 5,
      minute: 20 * 60 + 30,
    });
    // 2026-11-28 03:30 UTC = sábado 00:30 en Argentina.
    expect(localWeekdayMinute(new Date("2026-11-28T03:30:00Z"), "America/Argentina/Cordoba")).toEqual({
      weekday: 6,
      minute: 30,
    });
  });
});

describe("scheduleSlots", () => {
  const tz = "America/Argentina/Buenos_Aires"; // UTC-3, sin horario de verano
  // Lunes a domingo 12:00–14:00 y viernes 20:00–01:00.
  const ranges = [
    ...[0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: 720, closesAt: 840 })),
    { weekday: 5, opensAt: 1200, closesAt: 60 },
  ];
  const rules = { leadMinutes: 60, maxDays: 1 };

  it("respeta anticipación, horario y franjas de 30 min en hora local", () => {
    // Lunes 2026-11-23 10:40 local = 13:40 UTC. Primera franja posible: 11:40 → 12:00 local.
    const now = new Date("2026-11-23T13:40:00Z");
    const slots = scheduleSlots(ranges, tz, now, rules).map((d) => d.toISOString());
    expect(slots.slice(0, 4)).toEqual([
      "2026-11-23T15:00:00.000Z",
      "2026-11-23T15:30:00.000Z",
      "2026-11-23T16:00:00.000Z",
      "2026-11-23T16:30:00.000Z",
    ]);
    // 13:30–14:00 es la última del día; la de 14:00 queda afuera.
    expect(slots).not.toContain("2026-11-23T17:00:00.000Z");
    // Hasta 24 h después (martes 10:40 local): el martes todavía no abrió.
    expect(slots.at(-1)).toBe("2026-11-23T16:30:00.000Z");
  });

  it("no ofrece franjas antes de la anticipación mínima", () => {
    const now = new Date("2026-11-23T15:10:00Z"); // 12:10 local, abierto
    const slots = scheduleSlots(ranges, tz, now, rules).map((d) => d.toISOString());
    expect(slots[0]).toBe("2026-11-23T16:30:00.000Z"); // 13:10 → 13:30 local
  });

  it("incluye los rangos que cruzan la medianoche", () => {
    const now = new Date("2026-11-27T21:00:00Z"); // viernes 18:00 local
    const slots = scheduleSlots(ranges, tz, now, { leadMinutes: 30, maxDays: 1 }).map((d) => d.toISOString());
    expect(slots).toContain("2026-11-28T03:30:00.000Z"); // sábado 00:30–01:00 local
    expect(slots).not.toContain("2026-11-28T04:00:00.000Z"); // 01:00 ya cerró
  });

  it("isSchedulableSlot rechaza franjas desalineadas o fuera de horario", () => {
    const now = new Date("2026-11-23T13:40:00Z");
    expect(isSchedulableSlot(ranges, tz, now, rules, new Date("2026-11-23T15:30:00Z"))).toBe(true);
    expect(isSchedulableSlot(ranges, tz, now, rules, new Date("2026-11-23T15:15:00Z"))).toBe(false);
    expect(isSchedulableSlot(ranges, tz, now, rules, new Date("2026-11-23T18:00:00Z"))).toBe(false);
    expect(isSchedulableSlot(ranges, tz, now, rules, new Date("2026-11-25T15:00:00Z"))).toBe(false);
  });
});
