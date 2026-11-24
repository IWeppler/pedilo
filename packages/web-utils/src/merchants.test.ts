import { describe, expect, it } from "vitest";

import { scheduleByDay } from "./merchants";

describe("scheduleByDay", () => {
  it("agrupa por día, de lunes a domingo, con rangos ordenados y días cerrados", () => {
    const days = scheduleByDay([
      { weekday: 1, opensAt: "20:00", closesAt: "01:00" },
      { weekday: 1, opensAt: "11:30", closesAt: "14:30" },
      { weekday: 0, opensAt: "20:00", closesAt: "24:00" },
    ]);
    expect(days.map((d) => d.label)).toEqual(["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]);
    expect(days[0]).toMatchObject({ text: "11:30–14:30, 20:00–01:00", closed: false });
    expect(days[1]).toMatchObject({ text: "Cerrado", closed: true });
    expect(days[6]).toMatchObject({ text: "20:00–24:00" });
  });
});
