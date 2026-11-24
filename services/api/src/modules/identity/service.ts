import { eq, inArray } from "drizzle-orm";

import type { DbOrTx } from "../../db/client";
import { PlatformRole, type UserRow, users, UserStatus } from "./schema";
import type { VerifiedIdentity } from "./token-verifier";

export interface AuthContext {
  userId: string;
  email: string | null;
  phone: string | null;
  platformRole: PlatformRole | null;
  status: UserStatus;
}

/**
 * Devuelve el usuario del token, creándolo la primera vez que aparece (ADR 0004).
 * Los permisos se leen siempre de nuestra base, no del token.
 */
export async function resolveUser(db: DbOrTx, identity: VerifiedIdentity): Promise<AuthContext> {
  let [row] = await db.select().from(users).where(eq(users.id, identity.userId));

  if (!row) {
    await db
      .insert(users)
      .values({ id: identity.userId, email: identity.email, phone: identity.phone })
      .onConflictDoNothing({ target: users.id });
    [row] = await db.select().from(users).where(eq(users.id, identity.userId));
  } else if (row.email !== identity.email || row.phone !== identity.phone) {
    // Mantener sincronizados email/teléfono si cambiaron en Supabase.
    [row] = await db
      .update(users)
      .set({ email: identity.email, phone: identity.phone })
      .where(eq(users.id, identity.userId))
      .returning();
  }

  if (!row) throw new Error(`No se pudo resolver el usuario ${identity.userId}`);
  return toAuthContext(row);
}

export interface UserSummary {
  id: string;
  email: string | null;
  phone: string | null;
}

/** Datos de contacto de varios usuarios, para que otros módulos no lean la tabla `users`. */
export async function getUserSummaries(db: DbOrTx, ids: readonly string[]): Promise<Map<string, UserSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, email: users.email, phone: users.phone })
    .from(users)
    .where(inArray(users.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function setPlatformRole(db: DbOrTx, userId: string, role: PlatformRole | null) {
  const [row] = await db.update(users).set({ platformRole: role }).where(eq(users.id, userId)).returning();
  return row ?? null;
}

function toAuthContext(row: UserRow): AuthContext {
  return {
    userId: row.id,
    email: row.email,
    phone: row.phone,
    platformRole: row.platformRole ?? null,
    status: row.status,
  };
}

export const isAdmin = (auth: AuthContext | null) => auth?.platformRole === PlatformRole.ADMIN;
