/**
 * Horario semanal de una sucursal (SPEC §4.1, §15 business_hours).
 *
 * - `weekday`: 0 = domingo … 6 = sábado (como `Date.getDay()`).
 * - Horas en minutos desde medianoche (0–1440). En la API viajan como "HH:MM".
 * - Si `closesAt <= opensAt`, el rango cruza la medianoche (p. ej. 20:00–01:00).
 */
export interface OpeningRange {
  weekday: number;
  opensAt: number;
  closesAt: number;
}

export const MINUTES_PER_DAY = 1440;

export const WEEKDAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

/** "09:30" → 570. "24:00" → 1440. Devuelve null si el formato es inválido. */
export function parseTime(value: string): number | null {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= MINUTES_PER_DAY ? minutes : null;
}

/** 570 → "09:30". */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * ¿Está abierto en este día y minuto (hora LOCAL de la sucursal)?
 * Considera los rangos del día y los que vienen cruzando la medianoche desde el día anterior
 * (p. ej. viernes 20:00–01:00 cubre el sábado de 00:00 a 01:00).
 */
export function isOpenAt(ranges: readonly OpeningRange[], weekday: number, minute: number): boolean {
  const previous = (weekday + 6) % 7;
  return ranges.some((r) => {
    const overnight = r.closesAt <= r.opensAt;
    if (r.weekday === weekday) {
      return overnight ? minute >= r.opensAt : minute >= r.opensAt && minute < r.closesAt;
    }
    return overnight && r.weekday === previous && minute < r.closesAt;
  });
}

/** Día de la semana (0 = domingo) y minuto del día de un instante, en una zona horaria IANA. */
export function localWeekdayMinute(date: Date, timeZone: string): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

export const ScheduleError = {
  INVALID_WEEKDAY: "INVALID_WEEKDAY",
  INVALID_TIME: "INVALID_TIME",
  EMPTY_RANGE: "EMPTY_RANGE",
  OVERLAP: "OVERLAP",
} as const;
export type ScheduleError = (typeof ScheduleError)[keyof typeof ScheduleError];

export interface ScheduleProblem {
  error: ScheduleError;
  index: number;
}

/**
 * Valida un horario semanal completo. Reglas:
 * - día entre 0 y 6, horas entre 0 y 1440;
 * - un rango no puede durar 0 minutos;
 * - los rangos de un mismo día no se superponen (un rango que cruza la medianoche
 *   se considera hasta el final de ese día para este chequeo).
 */
export function validateSchedule(ranges: readonly OpeningRange[]): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  const valid: Array<{ index: number; weekday: number; start: number; end: number }> = [];

  ranges.forEach((r, index) => {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) {
      problems.push({ error: ScheduleError.INVALID_WEEKDAY, index });
      return;
    }
    const inDay = (m: number) => Number.isInteger(m) && m >= 0 && m <= MINUTES_PER_DAY;
    if (!inDay(r.opensAt) || !inDay(r.closesAt)) {
      problems.push({ error: ScheduleError.INVALID_TIME, index });
      return;
    }
    if (r.opensAt === r.closesAt || (r.opensAt === MINUTES_PER_DAY && r.closesAt === 0)) {
      problems.push({ error: ScheduleError.EMPTY_RANGE, index });
      return;
    }
    const end = r.closesAt > r.opensAt ? r.closesAt : MINUTES_PER_DAY;
    valid.push({ index, weekday: r.weekday, start: r.opensAt, end });
  });

  const byDay = new Map<number, typeof valid>();
  for (const v of valid) byDay.set(v.weekday, [...(byDay.get(v.weekday) ?? []), v]);
  for (const list of byDay.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.start < prev.end) problems.push({ error: ScheduleError.OVERLAP, index: cur.index });
    }
  }
  return problems;
}
