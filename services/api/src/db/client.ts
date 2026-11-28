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

/**
 * El pooler de Supabase en modo sesión tiene un cupo chico (15 clientes en total para todo el
 * proyecto): cada proceso usa pocas conexiones y suelta las que quedan sin uso. Si no, la API local,
 * la de Fly y un migrador juntos agotan el cupo (`EMAXCONNSESSION`).
 */
export function createDb(databaseUrl: string, poolMax = 5) {
  const client = postgres(databaseUrl, { max: poolMax, idle_timeout: 20, max_lifetime: 60 * 30 });
  const db: Db = drizzle(client, { schema });
  return { db, close: () => client.end({ timeout: 5 }) };
}
