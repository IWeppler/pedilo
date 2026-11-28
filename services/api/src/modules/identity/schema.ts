import { sql } from "drizzle-orm";
import { check, doublePrecision, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";

export const PlatformRole = { ADMIN: "ADMIN" } as const;
export type PlatformRole = (typeof PlatformRole)[keyof typeof PlatformRole];

export const UserStatus = { ACTIVE: "ACTIVE", SUSPENDED: "SUSPENDED" } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/**
 * Usuarios de Pedilo. El `id` es el `sub` del token de Supabase Auth (ADR 0004):
 * Supabase autentica, esta tabla autoriza.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email"),
    phone: text("phone"),
    /** Rol de plataforma. Los roles por comercio vivirán en `merchant_members`. */
    platformRole: text("platform_role").$type<PlatformRole>(),
    status: text("status").$type<UserStatus>().notNull().default(UserStatus.ACTIVE),
    ...timestamps,
  },
  (t) => [
    check("users_platform_role_check", sql`${t.platformRole} IS NULL OR ${t.platformRole} IN ('ADMIN')`),
    check("users_status_check", sql`${t.status} IN ('ACTIVE', 'SUSPENDED')`),
  ],
);

export type UserRow = typeof users.$inferSelect;

/**
 * Perfil del cliente con cuenta (ingreso con Google o Apple, ADR 0026). Pedir como invitado sigue
 * funcionando (ADR 0007): el perfil solo guarda cómo se llama y cómo contactarlo.
 */
export const customerProfiles = pgTable("customer_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  phone: text("phone").notNull(),
  ...timestamps,
});

export const AddressLabel = { HOME: "HOME", WORK: "WORK", OTHER: "OTHER" } as const;
export type AddressLabel = (typeof AddressLabel)[keyof typeof AddressLabel];

/**
 * Direcciones guardadas del cliente (ADR 0034): Casa, Trabajo y otras, hasta 5. En cada pedido el
 * cliente elige desde dónde pide; el pedido guarda una copia, así editar una dirección no cambia
 * pedidos hechos.
 */
export const customerAddresses = pgTable(
  "customer_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => customerProfiles.userId, { onDelete: "cascade" }),
    label: text("label").$type<AddressLabel>().notNull(),
    /** Nombre de una «Otra» (p. ej. «Casa de mamá»); en Casa y Trabajo, null. */
    name: text("name"),
    line: text("line").notNull(),
    notes: text("notes"),
    /** Punto exacto en el mapa (ADR 0023), si lo marcó. */
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    ...timestamps,
  },
  (t) => [
    index("customer_addresses_user_idx").on(t.userId),
    // Una sola Casa y un solo Trabajo por cliente.
    uniqueIndex("customer_addresses_label_unique").on(t.userId, t.label).where(sql`${t.label} IN ('HOME', 'WORK')`),
    check("customer_addresses_label_check", sql`${t.label} IN ('HOME', 'WORK', 'OTHER')`),
    check(
      "customer_addresses_location_check",
      sql`(${t.lat} IS NULL AND ${t.lng} IS NULL) OR (${t.lat} BETWEEN -90 AND 90 AND ${t.lng} BETWEEN -180 AND 180)`,
    ),
  ],
);

export type CustomerProfileRow = typeof customerProfiles.$inferSelect;
export type CustomerAddressRow = typeof customerAddresses.$inferSelect;
