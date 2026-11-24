import { ApiError, fieldErrors } from "@pedilo/api-client";

/** Estado que devuelven las Server Actions de formularios (useActionState). */
export interface FormState {
  message?: string;
  fieldErrors?: Record<string, string>;
  /** La acción terminó bien sin redirigir (p. ej. "Guardado"). */
  saved?: boolean;
  /** Valores enviados, para no perder lo tipeado cuando hay errores. */
  values?: Record<string, string>;
}

export const initialFormState: FormState = {};

/**
 * Key para remontar un <form> cuando la acción devuelve valores: así selects y checkboxes
 * muestran lo enviado (con defaultValue solo se aplica al montar).
 */
export function formKey(values: Record<string, string> | undefined): string {
  return values ? JSON.stringify(values) : "initial";
}

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("$ACTION") && typeof value === "string") out[key] = value;
  }
  return out;
}

/** Texto recortado; `undefined` si está vacío. */
export function optionalText(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function text(formData: FormData, key: string): string {
  return optionalText(formData, key) ?? "";
}

export function checkbox(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

export function optionalInt(formData: FormData, key: string): number | undefined {
  const value = optionalText(formData, key);
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : Number.NaN;
}

/** Traduce un error de la API al estado del formulario. Los errores de sesión se propagan. */
export function errorToFormState(err: unknown, values: Record<string, string>): FormState {
  if (err instanceof ApiError && !err.isUnauthorized && !err.isForbidden) {
    const fields = fieldErrors(err);
    const { _form, ...rest } = fields;
    return {
      message: _form ?? (Object.keys(rest).length > 0 ? "Revisá los campos marcados." : err.message),
      fieldErrors: rest,
      values,
    };
  }
  throw err;
}

/**
 * Monto en pesos tipeado por una persona → centavos enteros.
 * Acepta "1500", "1500.5", "1500,50" y "1.500,50" (formato argentino con separador de miles).
 * Devuelve `undefined` si está vacío y `NaN` si no es un monto válido (la API lo rechaza).
 */
export function parsePesosToMinor(raw: string): number | undefined {
  const value = raw.trim().replace(/\s|\$/g, "");
  if (value === "") return undefined;
  let normalized = value;
  if (value.includes(",")) {
    // Con coma decimal, los puntos son separadores de miles.
    normalized = value.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    // "1.500" o "12.000.000" sin coma: puntos como miles.
    normalized = value.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}

export function optionalMoney(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? parsePesosToMinor(value) : undefined;
}

/** Centavos → texto editable en un input ("1500,50" / "1500"). */
export function minorToPesosInput(minor: number): string {
  const pesos = Math.trunc(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(pesos) : `${pesos},${String(cents).padStart(2, "0")}`;
}
