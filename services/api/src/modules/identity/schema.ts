import { sql } from "drizzle-orm";
import { check, doublePrecision, pgTable, text, uuid } from "drizzle-orm/pg-core";

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
  /** Dirección de entrega guardada: el checkout la usa sin volver a pedirla (se puede cambiar). */
  addressLine: text("address_line"),
  addressNotes: text("address_notes"),
  /** Punto exacto en el mapa (ADR 0023), si lo marcó. */
  addressLat: doublePrecision("address_lat"),
  addressLng: doublePrecision("address_lng"),
  ...timestamps,
}, (t) => [
  check(
    "customer_profiles_location_check",
    sql`(${t.addressLat} IS NULL AND ${t.addressLng} IS NULL) OR (${t.addressLat} BETWEEN -90 AND 90 AND ${t.addressLng} BETWEEN -180 AND 180)`,
  ),
]);

export type CustomerProfileRow = typeof customerProfiles.$inferSelect;
