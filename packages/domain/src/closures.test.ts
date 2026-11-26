import { describe, expect, it } from "vitest";

import { closureOn, isOpenAtInstant, localDateKey, scheduleSlots, validateClosure } from "./schedule";

const tz = "America/Argentina/Buenos_Aires"; // UTC-3
const allDay = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: 0, closesAt: 1440 }));

describe("cierres excepcionales", () => {
  it("la fecha local es la de la sucursal, no la UTC", () => {
    // 2026-12-25 02:00 UTC = 24/12 23:00 en Argentina.
    expect(localDateKey(new Date("2026-12-25T02:00:00Z"), tz)).toBe("2026-12-24");
    expect(localDateKey(new Date("2026-12-25T03:00:00Z"), tz)).toBe("2026-12-25");
  });

  it("closureOn incluye los extremos", () => {
    const closures = [{ startsOn: "2026-12-24", endsOn: "2026-12-25", reason: "Navidad" }];
    expect(closureOn(closures, "2026-12-23")).toBeUndefined();
    expect(closureOn(closures, "2026-12-24")?.reason).toBe("Navidad");
    expect(closureOn(closures, "2026-12-25")).toBeDefined();
    expect(closureOn(closures, "2026-12-26")).toBeUndefined();
  });

  it("un cierre gana al horario semanal", () => {
    const closures = [{ startsOn: "2026-12-25", endsOn: "2026-12-25" }];
    expect(isOpenAtInstant(allDay, closures, tz, new Date("2026-12-25T15:00:00Z"))).toBe(false);
    expect(isOpenAtInstant(allDay, closures, tz, new Date("2026-12-26T15:00:00Z"))).toBe(true);
  });

  it("no ofrece franjas en días cerrados", () => {
    const now = new Date("2026-12-24T12:00:00Z"); // 24/12 09:00 local
    const slots = scheduleSlots(allDay, tz, now, { leadMinutes: 60, maxDays: 3, closures: [{ startsOn: "2026-12-25", endsOn: "2026-12-25" }] });
    const days = new Set(slots.map((s) => localDateKey(s, tz)));
    expect(days.has("2026-12-24")).toBe(true);
    expect(days.has("2026-12-25")).toBe(false);
    expect(days.has("2026-12-26")).toBe(true);
  });

  it("validateClosure", () => {
    const today = "2026-11-26";
    expect(validateClosure({ startsOn: "2026-12-24", endsOn: "2026-12-25" }, today)).toBeNull();
    expect(validateClosure({ startsOn: "2026-11-20", endsOn: "2026-11-27" }, today)).toBeNull(); // en curso
    expect(validateClosure({ startsOn: "2026-12-25", endsOn: "2026-12-24" }, today)).toBe("ENDS_BEFORE_START");
    expect(validateClosure({ startsOn: "2026-11-01", endsOn: "2026-11-02" }, today)).toBe("IN_THE_PAST");
    expect(validateClosure({ startsOn: "2026-12-01", endsOn: "2027-03-01" }, today)).toBe("TOO_LONG");
    expect(validateClosure({ startsOn: "2026-02-30", endsOn: "2026-03-01" }, today)).toBe("INVALID_DATE");
    expect(validateClosure({ startsOn: "25/12/2026", endsOn: "2026-12-25" }, today)).toBe("INVALID_DATE");
  });
});
