import { eq, inArray } from "drizzle-orm";

import type { DbOrTx } from "../../db/client";
import { customerProfiles, type CustomerProfileRow, PlatformRole, type UserRow, users, UserStatus } from "./schema";
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

// ---------------------------------------------------------------------------
// Perfil del cliente (ADR 0026)
// ---------------------------------------------------------------------------

export interface CustomerAddress {
  line: string;
  notes: string | null;
  location: { lat: number; lng: number } | null;
}

export interface CustomerProfileDto {
  displayName: string;
  phone: string;
  email: string | null;
  /** Dirección de entrega guardada (null = todavía no cargó ninguna). */
  address: CustomerAddress | null;
}

const toProfileDto = (row: CustomerProfileRow, email: string | null): CustomerProfileDto => ({
  displayName: row.displayName,
  phone: row.phone,
  email,
  address: row.addressLine
    ? {
        line: row.addressLine,
        notes: row.addressNotes,
        location: row.addressLat !== null && row.addressLng !== null ? { lat: row.addressLat, lng: row.addressLng } : null,
      }
    : null,
});

/** `null` = entró pero todavía no completó el registro. */
export async function getCustomerProfile(db: DbOrTx, auth: AuthContext): Promise<CustomerProfileDto | null> {
  const [row] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, auth.userId));
  return row ? toProfileDto(row, auth.email) : null;
}

/**
 * Registro y edición: crea el perfil o lo actualiza. `address` ausente deja la guardada como está;
 * `null` la borra.
 */
export async function saveCustomerProfile(
  db: DbOrTx,
  auth: AuthContext,
  input: { displayName: string; phone: string; address?: { line: string; notes?: string | null | undefined; location?: { lat: number; lng: number } | null | undefined } | null | undefined },
): Promise<CustomerProfileDto> {
  const address =
    input.address === undefined
      ? {}
      : {
          addressLine: input.address?.line ?? null,
          addressNotes: input.address?.notes || null,
          addressLat: input.address?.location?.lat ?? null,
          addressLng: input.address?.location?.lng ?? null,
        };
  const values = { displayName: input.displayName, phone: input.phone, ...address };
  const [row] = await db
    .insert(customerProfiles)
    .values({ userId: auth.userId, ...values })
    .onConflictDoUpdate({ target: customerProfiles.userId, set: values })
    .returning();
  return toProfileDto(row!, auth.email);
}
