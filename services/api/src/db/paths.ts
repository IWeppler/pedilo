import { fileURLToPath } from "node:url";

/** Carpeta de migraciones SQL generadas por drizzle-kit (se commitean). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
