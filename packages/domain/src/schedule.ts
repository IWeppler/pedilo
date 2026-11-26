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

// ---------------------------------------------------------------------------
// Pedidos programados (SPEC §7.1, ADR 0011)
// ---------------------------------------------------------------------------

/** Duración de cada franja horaria para programar pedidos. */
export const SLOT_MINUTES = 30;

export interface SchedulingRules {
  /** Anticipación mínima: no se puede programar para antes de ahora + esto (fecha de corte). */
  leadMinutes: number;
  /** Hasta cuántos días adelante se puede programar. */
  maxDays: number;
  /** Cierres excepcionales: esos días no hay franjas. */
  closures?: readonly ClosurePeriod[];
}

/**
 * Franjas en las que se puede programar un pedido, en orden. Cada franja empieza en un múltiplo
 * de 30 minutos de la hora LOCAL de la sucursal y tiene que caer entera dentro del horario
 * (abierto al empezar y en su último minuto).
 */
export function scheduleSlots(
  ranges: readonly OpeningRange[],
  timeZone: string,
  now: Date,
  rules: SchedulingRules,
): Date[] {
  const minuteMs = 60_000;
  const earliest = new Date(Math.ceil((now.getTime() + rules.leadMinutes * minuteMs) / minuteMs) * minuteMs);
  const { minute } = localWeekdayMinute(earliest, timeZone);
  const first = earliest.getTime() + ((SLOT_MINUTES - (minute % SLOT_MINUTES)) % SLOT_MINUTES) * minuteMs;
  const last = now.getTime() + rules.maxDays * MINUTES_PER_DAY * minuteMs;

  const slots: Date[] = [];
  for (let t = first; t <= last; t += SLOT_MINUTES * minuteMs) {
    const start = localWeekdayMinute(new Date(t), timeZone);
    const end = localWeekdayMinute(new Date(t + (SLOT_MINUTES - 1) * minuteMs), timeZone);
    const closed =
      rules.closures?.length &&
      (closureOn(rules.closures, localDateKey(new Date(t), timeZone)) ||
        closureOn(rules.closures, localDateKey(new Date(t + (SLOT_MINUTES - 1) * minuteMs), timeZone)));
    if (!closed && isOpenAt(ranges, start.weekday, start.minute) && isOpenAt(ranges, end.weekday, end.minute)) {
      slots.push(new Date(t));
    }
  }
  return slots;
}

/** ¿`slot` es una de las franjas válidas ahora? (horario, anticipación, máximo de días y alineación). */
export function isSchedulableSlot(
  ranges: readonly OpeningRange[],
  timeZone: string,
  now: Date,
  rules: SchedulingRules,
  slot: Date,
): boolean {
  return scheduleSlots(ranges, timeZone, now, rules).some((s) => s.getTime() === slot.getTime());
}

// ---------------------------------------------------------------------------
// Cierres excepcionales (SPEC §15 special_hours, ADR 0018)
// ---------------------------------------------------------------------------

/** Días completos de cierre (feriados, vacaciones), en la fecha LOCAL de la sucursal. Inclusive. */
export interface ClosurePeriod {
  /** "YYYY-MM-DD" */
  startsOn: string;
  /** "YYYY-MM-DD", igual o posterior a startsOn. */
  endsOn: string;
}

/** Máximo de días de un cierre (para no cerrar un comercio "para siempre" por error). */
export const MAX_CLOSURE_DAYS = 60;

const dateKeyFormats = new Map<string, Intl.DateTimeFormat>();

/** Fecha local "YYYY-MM-DD" de un instante en una zona horaria IANA. */
export function localDateKey(date: Date, timeZone: string): string {
  let format = dateKeyFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateKeyFormats.set(timeZone, format);
  }
  return format.format(date);
}

/** El cierre que cubre esa fecha local, si hay. Las fechas "YYYY-MM-DD" se comparan como texto. */
export function closureOn<C extends ClosurePeriod>(closures: readonly C[], dateKey: string): C | undefined {
  return closures.find((c) => c.startsOn <= dateKey && dateKey <= c.endsOn);
}

/** ¿Está abierta en este instante, contando el horario semanal y los cierres excepcionales? */
export function isOpenAtInstant(
  ranges: readonly OpeningRange[],
  closures: readonly ClosurePeriod[],
  timeZone: string,
  date: Date,
): boolean {
  if (closureOn(closures, localDateKey(date, timeZone))) return false;
  const { weekday, minute } = localWeekdayMinute(date, timeZone);
  return isOpenAt(ranges, weekday, minute);
}

export const ClosureError = {
  INVALID_DATE: "INVALID_DATE",
  ENDS_BEFORE_START: "ENDS_BEFORE_START",
  TOO_LONG: "TOO_LONG",
  IN_THE_PAST: "IN_THE_PAST",
} as const;
export type ClosureError = (typeof ClosureError)[keyof typeof ClosureError];

/** Valida un cierre nuevo respecto de "hoy" (fecha local). */
export function validateClosure(c: ClosurePeriod, todayKey: string): ClosureError | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const valid = (s: string) => re.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
  if (!valid(c.startsOn) || !valid(c.endsOn)) return ClosureError.INVALID_DATE;
  if (c.endsOn < c.startsOn) return ClosureError.ENDS_BEFORE_START;
  if (c.endsOn < todayKey) return ClosureError.IN_THE_PAST;
  const days = (Date.parse(`${c.endsOn}T00:00:00Z`) - Date.parse(`${c.startsOn}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_CLOSURE_DAYS) return ClosureError.TOO_LONG;
  return null;
}
