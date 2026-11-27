/**
 * Teléfono celular argentino. El repartidor escribe código de área + número, todo junto y sin
 * 0 ni 15 (10 dígitos: «3491123456»); la app muestra el +54 fijo y guarda el formato
 * internacional de celular, +54 9 + esos 10 dígitos («+5493491123456»), que sirve para llamar
 * y para WhatsApp desde cualquier lado.
 */
export const PHONE_DIGITS = 10;

/** Deja solo los dígitos útiles; si pegan el número completo (+54 9 …, 0 …), lo recorta. */
export function cleanPhoneInput(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > PHONE_DIGITS && d.startsWith("54")) d = d.slice(2);
  if (d.length > PHONE_DIGITS && d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, PHONE_DIGITS);
}

export const isValidPhone = (digits: string) => digits.length === PHONE_DIGITS;

export const toE164 = (digits: string) => `+549${digits}`;
