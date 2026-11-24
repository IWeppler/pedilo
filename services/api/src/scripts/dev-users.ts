import { createHash } from "node:crypto";

/**
 * Usuarios de desarrollo con id determinístico a partir de un nombre: el mismo nombre da siempre
 * el mismo id. Así `npm run dev:token -- --name esquina` entra como el dueño que creó el seed demo.
 */
export function devUserId(name: string): string {
  const h = createHash("sha256").update(`pedilo-dev:${name}`).digest("hex");
  const variant = ((parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const devUserEmail = (name: string) => `${name}@dev.pedilo.local`;
