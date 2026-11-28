import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { FastifyInstance } from "fastify";

import { type AppDeps, buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { MIGRATIONS_FOLDER } from "../src/db/paths";
import * as schema from "../src/db/schema";
import { generateDevKeyPair, signDevToken } from "../src/modules/identity/dev-keys";
import { createLocalVerifier } from "../src/modules/identity/token-verifier";

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  /** Token de un usuario nuevo (se crea en la base al primer request). */
  tokenFor(opts?: { email?: string; userId?: string }): Promise<{ token: string; userId: string }>;
  /** Token de un usuario con rol ADMIN ya persistido. */
  adminToken(): Promise<string>;
  /** Token de un cliente registrado (con perfil): el único que puede hacer pedidos (ADR 0026). */
  customerToken(profile?: { displayName?: string; phone?: string }): Promise<string>;
  close(): Promise<void>;
}

/**
 * Postgres real en memoria (PGlite) con las migraciones del repo aplicadas,
 * y la app construida con un verificador de tokens local.
 */
export async function createTestContext(
  configOverrides: Partial<AppDeps["config"]> = {},
  extra: Pick<AppDeps, "payments"> = {},
): Promise<TestContext> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });

  const keys = await generateDevKeyPair();
  const app = await buildApp({
    config: { env: "test", logLevel: "silent", corsOrigins: [], orderTokenSecret: "test-order-token-secret", ...configOverrides },
    db,
    tokenVerifier: createLocalVerifier(keys.publicKey),
    ...extra,
  });
  await app.ready();

  const tokenFor: TestContext["tokenFor"] = async (opts = {}) => {
    const userId = opts.userId ?? randomUUID();
    const token = await signDevToken(keys.privateKey, {
      sub: userId,
      email: opts.email ?? `${userId.slice(0, 8)}@test.pedilo.local`,
    });
    return { token, userId };
  };

  return {
    app,
    db,
    tokenFor,
    async adminToken() {
      const { token, userId } = await tokenFor();
      await db.insert(schema.users).values({ id: userId, platformRole: "ADMIN" });
      return token;
    },
    async customerToken(profile = {}) {
      const { token, userId } = await tokenFor();
      await db.insert(schema.users).values({ id: userId });
      await db
        .insert(schema.customerProfiles)
        .values({ userId, displayName: profile.displayName ?? "Ana", phone: profile.phone ?? "3491 555-123" });
      return token;
    },
    async close() {
      await app.close();
      await client.close();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export async function auditRowsFor(db: Db, entityId: string) {
  return db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, entityId));
}
