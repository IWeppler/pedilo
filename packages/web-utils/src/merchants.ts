import type { MerchantStatus, OnboardingProblem, OpeningRange } from "@pedilo/api-client";

/** Textos y formatos de comercios compartidos por el panel admin y el panel del comercio. */

export const MERCHANT_STATUS_LABELS: Record<MerchantStatus, string> = {
  DRAFT: "Borrador",
  PENDING_REVIEW: "En revisión",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

export const ONBOARDING_ISSUE_LABELS: Record<OnboardingProblem["issue"], string> = {
  NO_ACTIVE_BRANCH: "Cargá al menos una sucursal activa.",
  BRANCH_WITHOUT_HOURS: "Falta cargar el horario de la sucursal.",
  BRANCH_WITHOUT_FULFILLMENT: "La sucursal tiene que aceptar retiro en el local o tener envío con al menos una zona.",
};

const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;
/** Orden de la semana como se usa en Argentina: lunes primero. */
export const WEEKDAYS_MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? String(weekday);
}

export interface DaySchedule {
  weekday: number;
  label: string;
  /** "11:30–14:30, 20:00–01:00" o "Cerrado". */
  text: string;
  closed: boolean;
}

/** Horario agrupado por día, de lunes a domingo, para mostrar. */
export function scheduleByDay(ranges: readonly OpeningRange[]): DaySchedule[] {
  return WEEKDAYS_MONDAY_FIRST.map((weekday) => {
    const day = ranges
      .filter((r) => r.weekday === weekday)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((r) => `${r.opensAt}–${r.closesAt}`);
    return { weekday, label: weekdayLabel(weekday), text: day.length ? day.join(", ") : "Cerrado", closed: day.length === 0 };
  });
}

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

/** ISO → "23/11/26, 14:05" (hora de Argentina). */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : "—";
}
