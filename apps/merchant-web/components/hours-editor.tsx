"use client";

import type { OpeningRange } from "@pedilo/api-client";
import { type FormState, initialFormState, WEEKDAYS_MONDAY_FIRST, weekdayLabel } from "@pedilo/web-utils";
import { startTransition, useActionState, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface DayState {
  open: boolean;
  split: boolean;
  r1: [string, string];
  r2: [string, string];
}

type Week = Record<number, DayState>;

const DEFAULT_DAY: DayState = { open: false, split: false, r1: ["09:00", "13:00"], r2: ["17:00", "21:00"] };

function toWeek(hours: OpeningRange[]): Week {
  const week: Week = {};
  for (const wd of WEEKDAYS_MONDAY_FIRST) {
    const ranges = hours.filter((h) => h.weekday === wd).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
    const [first, second] = ranges;
    // <input type="time"> no admite 24:00: medianoche se muestra como 00:00 (cierre que cruza el día).
    const t = (s: string) => (s === "24:00" ? "00:00" : s);
    week[wd] = {
      open: ranges.length > 0,
      split: ranges.length > 1,
      r1: first ? [t(first.opensAt), t(first.closesAt)] : DEFAULT_DAY.r1,
      r2: second ? [t(second.opensAt), t(second.closesAt)] : DEFAULT_DAY.r2,
    };
  }
  return week;
}

function toRanges(week: Week): OpeningRange[] {
  return WEEKDAYS_MONDAY_FIRST.flatMap((wd) => {
    const d = week[wd]!;
    if (!d.open) return [];
    const ranges = [{ weekday: wd, opensAt: d.r1[0], closesAt: d.r1[1] }];
    if (d.split) ranges.push({ weekday: wd, opensAt: d.r2[0], closesAt: d.r2[1] });
    return ranges;
  });
}

/**
 * Horario semanal: por día, abierto/cerrado, un rango o horario cortado (dos rangos).
 * Un cierre anterior a la apertura (p. ej. 20:00–01:00) significa que cierra después de medianoche.
 */
export function HoursEditor({
  action,
  hours,
  disabled,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  hours: OpeningRange[];
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [week, setWeek] = useState<Week>(() => toWeek(hours));
  const [dirty, setDirty] = useState(false);

  const update = (wd: number, patch: Partial<DayState>) => {
    setWeek((w) => ({ ...w, [wd]: { ...w[wd]!, ...patch } }));
    setDirty(true);
  };
  const copyMondayTo = (days: readonly number[]) => {
    setWeek((w) => {
      const next = { ...w };
      for (const wd of days) next[wd] = { ...w[1]!, r1: [...w[1]!.r1], r2: [...w[1]!.r2] };
      return next;
    });
    setDirty(true);
  };

  return (
    // Se envía desde onSubmit (no con `action`) para evitar el reseteo automático del form de React 19,
    // que desmarca los checkboxes controlados aunque el estado diga lo contrario.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setDirty(false);
        startTransition(() => formAction(data));
      }}
      className="grid gap-4"
    >
      <input type="hidden" name="ranges" value={JSON.stringify(toRanges(week))} />
      {state.message && (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {state.saved && !dirty && (
        <Alert>
          <AlertDescription>Horario guardado.</AlertDescription>
        </Alert>
      )}

      <fieldset disabled={disabled} className="grid gap-3">
        <legend className="sr-only">Horario semanal</legend>
        {WEEKDAYS_MONDAY_FIRST.map((wd) => {
          const d = week[wd]!;
          const label = weekdayLabel(wd);
          return (
            <div key={wd} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[8rem_1fr] sm:items-start">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={d.open}
                  onChange={(e) => update(wd, { open: e.target.checked })}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
              {d.open ? (
                <div className="grid gap-2">
                  <TimeRange
                    label={label}
                    value={d.r1}
                    onChange={(r1) => update(wd, { r1 })}
                  />
                  {d.split && <TimeRange label={`${label}, segundo turno`} value={d.r2} onChange={(r2) => update(wd, { r2 })} />}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={d.split}
                      onChange={(e) => update(wd, { split: e.target.checked })}
                      className="size-3.5 accent-primary"
                    />
                    Horario cortado (dos turnos)
                  </label>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Cerrado</span>
              )}
            </div>
          );
        })}
      </fieldset>

      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => copyMondayTo([2, 3, 4, 5])}>
            Copiar lunes a martes–viernes
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => copyMondayTo([2, 3, 4, 5, 6, 0])}>
            Copiar lunes a todos los días
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando…" : "Guardar horario"}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Si cerrás después de medianoche, poné la hora de cierre tal cual (por ejemplo 20:00 a 01:00).
      </p>
    </form>
  );
}

function TimeRange({
  label,
  value,
  onChange,
}: {
  label: string;
  value: [string, string];
  onChange: (v: [string, string]) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="time"
        aria-label={`${label}: abre`}
        value={value[0]}
        onChange={(e) => onChange([e.target.value, value[1]])}
        required
        className="w-32"
      />
      <span className="text-sm text-muted-foreground">a</span>
      <Input
        type="time"
        aria-label={`${label}: cierra`}
        value={value[1]}
        onChange={(e) => onChange([value[0], e.target.value])}
        required
        className="w-32"
      />
    </div>
  );
}
