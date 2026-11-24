/**
 * Borra TODA la base local y la recrea vacía con las migraciones.
 *
 *   npm run db:reset -w @pedilo/api       (después corre seed + seed:demo)
 *
 * Solo funciona contra una base en localhost y fuera de producción: es para desarrollo.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { loadConfig } from "../config";
import { MIGRATIONS_FOLDER } from "./paths";

const config = loadConfig();
const host = new URL(config.databaseUrl).hostname;
if (config.env === "production" || !["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(`db:reset solo se permite contra una base local (host actual: ${host}).`);
  process.exit(1);
}

const client = postgres(config.databaseUrl, { max: 1, onnotice: () => {} });
try {
  await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Base local reseteada y migrada.");
} finally {
  await client.end();
}
