import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Schema = typeof schema;

/** Base de datos independiente del driver: postgres.js en dev/prod, PGlite en tests. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Cualquier cosa sobre la que se pueden ejecutar queries: la base o una transacción abierta. */
export type DbOrTx = Db | Tx;

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
