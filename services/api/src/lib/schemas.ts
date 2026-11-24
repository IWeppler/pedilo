import { z } from "zod";

import { SLUG_PATTERN } from "./slug";

export const idParamsSchema = z.object({ id: z.uuid() });

export const slugSchema = z
  .string()
  .max(80)
  .regex(SLUG_PATTERN, "Solo minúsculas, números y guiones (p. ej. 'tostado')");

export const nameSchema = z.string().trim().min(2).max(80);

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("es-AR", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "Zona horaria IANA inválida (p. ej. 'America/Argentina/Cordoba')" },
);

/** Exige al menos un campo en un PATCH. */
export function nonEmptyPatch<T extends z.ZodObject>(schema: T) {
  return schema.refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Enviá al menos un campo para actualizar",
  });
}
