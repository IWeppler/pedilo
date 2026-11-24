/**
 * CUIT/CUIL argentino: 11 dígitos con dígito verificador (módulo 11).
 * Acepta "20-12345678-6" o "20123456786"; normaliza a solo dígitos.
 */
const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

export function normalizeCuit(value: string): string {
  return value.replace(/[\s.-]/g, "");
}

export function isValidCuit(value: string): boolean {
  const digits = normalizeCuit(value);
  if (!/^\d{11}$/.test(digits)) return false;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod;
  if (check === 10) return false;
  return check === Number(digits[10]);
}

/** "20123456786" → "20-12345678-6". */
export function formatCuit(value: string): string {
  const d = normalizeCuit(value);
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : value;
}
