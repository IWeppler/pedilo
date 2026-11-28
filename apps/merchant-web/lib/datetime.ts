/**
 * Fechas de los formularios en hora de Argentina (sin horario de verano: siempre UTC−3), sin
 * depender de la zona horaria del servidor donde corre la acción.
 */
const AR_OFFSET = "-03:00";
const AR_TZ = "America/Argentina/Buenos_Aires";

/** "2026-12-01T10:00" (input datetime-local, hora de Argentina) → ISO. Vacío → null. */
export function localInputToIso(value: string | undefined): string | null {
  if (!value) return null;
  return new Date(`${value}:00${AR_OFFSET}`).toISOString();
}

/** ISO → "2026-12-01T10:00" en hora de Argentina, para el valor de un datetime-local. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
