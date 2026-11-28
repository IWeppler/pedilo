import { MAX_CUSTOMER_ADDRESSES } from "@pedilo/domain";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import type { Db, DbOrTx } from "../../db/client";
import { conflict, isUniqueViolation, notFound } from "../../lib/errors";
import {
  type AddressLabel,
  customerAddresses,
  type CustomerAddressRow,
  customerProfiles,
  type CustomerProfileRow,
  PlatformRole,
  type UserRow,
  users,
  UserStatus,
} from "./schema";
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

export interface CustomerAddressDto {
  id: string;
  label: AddressLabel;
  /** Nombre de una «Otra»; null en Casa y Trabajo. */
  name: string | null;
  line: string;
  notes: string | null;
  location: { lat: number; lng: number } | null;
}

export interface CustomerProfileDto {
  displayName: string;
  phone: string;
  email: string | null;
  /** Direcciones guardadas (ADR 0034): Casa, Trabajo y después las otras, de la más vieja a la más nueva. */
  addresses: CustomerAddressDto[];
}

export interface CustomerAddressInput {
  label: AddressLabel;
  name?: string | null | undefined;
  line: string;
  notes?: string | null | undefined;
  location?: { lat: number; lng: number } | null | undefined;
}

const LABEL_ORDER: Record<AddressLabel, number> = { HOME: 0, WORK: 1, OTHER: 2 };

const toAddressDto = (r: CustomerAddressRow): CustomerAddressDto => ({
  id: r.id,
  label: r.label,
  name: r.label === "OTHER" ? r.name : null,
  line: r.line,
  notes: r.notes,
  location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
});

async function listAddresses(db: DbOrTx, userId: string): Promise<CustomerAddressDto[]> {
  const rows = await db.select().from(customerAddresses).where(eq(customerAddresses.userId, userId)).orderBy(asc(customerAddresses.createdAt));
  return rows.sort((a, b) => LABEL_ORDER[a.label] - LABEL_ORDER[b.label]).map(toAddressDto);
}

const toProfileDto = (row: CustomerProfileRow, email: string | null, addresses: CustomerAddressDto[]): CustomerProfileDto => ({
  displayName: row.displayName,
  phone: row.phone,
  email,
  addresses,
});

/** `null` = entró pero todavía no completó el registro. */
export async function getCustomerProfile(db: DbOrTx, auth: AuthContext): Promise<CustomerProfileDto | null> {
  const [row] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, auth.userId));
  return row ? toProfileDto(row, auth.email, await listAddresses(db, auth.userId)) : null;
}

/** Registro y edición del nombre y el teléfono. Las direcciones van por sus propias rutas. */
export async function saveCustomerProfile(db: DbOrTx, auth: AuthContext, input: { displayName: string; phone: string }): Promise<CustomerProfileDto> {
  const values = { displayName: input.displayName, phone: input.phone };
  const [row] = await db
    .insert(customerProfiles)
    .values({ userId: auth.userId, ...values })
    .onConflictDoUpdate({ target: customerProfiles.userId, set: values })
    .returning();
  return toProfileDto(row!, auth.email, await listAddresses(db, auth.userId));
}

const addressValues = (input: CustomerAddressInput) => ({
  label: input.label,
  name: input.label === "OTHER" ? input.name?.trim() || null : null,
  line: input.line.trim(),
  notes: input.notes?.trim() || null,
  lat: input.location?.lat ?? null,
  lng: input.location?.lng ?? null,
});

const labelTaken = (label: AddressLabel) =>
  conflict(label === "HOME" ? "Ya tenés una dirección de Casa" : "Ya tenés una dirección de Trabajo", { reason: "ADDRESS_LABEL_TAKEN" });

/**
 * Guarda una dirección nueva. Hace falta el perfil (409 PROFILE_REQUIRED). Hasta 5 por cliente
 * (409 ADDRESS_LIMIT) y una sola Casa y un solo Trabajo (409 ADDRESS_LABEL_TAKEN).
 */
export async function addCustomerAddress(db: Db, auth: AuthContext, input: CustomerAddressInput): Promise<CustomerAddressDto> {
  return db.transaction(async (tx) => {
    // El perfil bloqueado ordena dos altas al mismo tiempo: el límite no se pasa.
    const [profile] = await tx.select({ userId: customerProfiles.userId }).from(customerProfiles).where(eq(customerProfiles.userId, auth.userId)).for("update");
    if (!profile) throw conflict("Completá tu registro antes de guardar direcciones", { reason: "PROFILE_REQUIRED" });
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(customerAddresses).where(eq(customerAddresses.userId, auth.userId));
    if (n >= MAX_CUSTOMER_ADDRESSES) {
      throw conflict(`Podés guardar hasta ${MAX_CUSTOMER_ADDRESSES} direcciones`, { reason: "ADDRESS_LIMIT" });
    }
    try {
      const [row] = await tx.insert(customerAddresses).values({ userId: auth.userId, ...addressValues(input) }).returning();
      return toAddressDto(row!);
    } catch (err) {
      if (isUniqueViolation(err)) throw labelTaken(input.label);
      throw err;
    }
  });
}

/** Edita una dirección propia (404 si no es suya). */
export async function updateCustomerAddress(db: DbOrTx, auth: AuthContext, id: string, input: CustomerAddressInput): Promise<CustomerAddressDto> {
  try {
    const [row] = await db
      .update(customerAddresses)
      .set(addressValues(input))
      .where(and(eq(customerAddresses.id, id), eq(customerAddresses.userId, auth.userId)))
      .returning();
    if (!row) throw notFound("Dirección");
    return toAddressDto(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw labelTaken(input.label);
    throw err;
  }
}

/** Borra una dirección propia (404 si no es suya). Los pedidos hechos guardan su copia. */
export async function deleteCustomerAddress(db: DbOrTx, auth: AuthContext, id: string): Promise<void> {
  const deleted = await db
    .delete(customerAddresses)
    .where(and(eq(customerAddresses.id, id), eq(customerAddresses.userId, auth.userId)))
    .returning({ id: customerAddresses.id });
  if (deleted.length === 0) throw notFound("Dirección");
}
