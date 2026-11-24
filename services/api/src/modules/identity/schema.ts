import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";

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
