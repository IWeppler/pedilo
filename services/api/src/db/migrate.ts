import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { loadConfig } from "../config";
import { MIGRATIONS_FOLDER } from "./paths";

const config = loadConfig();
const client = postgres(config.databaseUrl, { max: 1 });

try {
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("Migraciones aplicadas.");
} finally {
  await client.end();
}
