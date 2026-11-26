import type { MerchantRole, MerchantStatus } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Excepción documentada a "un módulo no importa tablas de otro": solo para declarar FKs
// a nivel base de datos. Las lecturas y validaciones van por los servicios de cada módulo.
import { categories } from "../catalog/schema";
import { cities } from "../geography/schema";
import { users } from "../identity/schema";

/** Comercio (SPEC §15). Pertenece a un rubro (categoría MERCHANT) que define su tope de comisión. */
export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name").notNull(),
    /** CUIT normalizado (11 dígitos). */
    taxId: text("tax_id").notNull(),
    slug: text("slug").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email"),
    /** Medios de pago que acepta (ADR 0011). Siempre al menos uno. */
    acceptsCash: boolean("accepts_cash").notNull().default(true),
    acceptsTransfer: boolean("accepts_transfer").notNull().default(false),
    /** Datos para transferir: se copian al pedido (el cliente los ve solo después de pedir). */
    transferAlias: text("transfer_alias"),
    transferCbu: text("transfer_cbu"),
    transferHolder: text("transfer_holder"),
    /** Logo y portada (rutas en el almacenamiento, ADR 0017). */
    logoPath: text("logo_path"),
    coverPath: text("cover_path"),
    status: text("status").$type<MerchantStatus>().notNull().default("DRAFT"),
    /** Motivo del último rechazo o de la suspensión (lo ve el comercio). */
    rejectionReason: text("rejection_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("merchants_slug_unique").on(t.slug),
    index("merchants_status_idx").on(t.status, t.submittedAt),
    check(
      "merchants_status_check",
      sql`${t.status} IN ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')`,
    ),
    check("merchants_tax_id_check", sql`${t.taxId} ~ '^[0-9]{11}$'`),
    check("merchants_payment_method_check", sql`${t.acceptsCash} OR ${t.acceptsTransfer}`),
    check(
      "merchants_transfer_details_check",
      sql`NOT ${t.acceptsTransfer} OR ((${t.transferAlias} IS NOT NULL OR ${t.transferCbu} IS NOT NULL) AND ${t.transferHolder} IS NOT NULL)`,
    ),
  ],
);

/** Quién puede operar cada comercio. La autorización por comercio se resuelve acá (SPEC §5). */
export const merchantMembers = pgTable(
  "merchant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<MerchantRole>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("merchant_members_unique").on(t.merchantId, t.userId),
    index("merchant_members_user_idx").on(t.userId),
    check("merchant_members_role_check", sql`${t.role} IN ('OWNER', 'OPERATOR')`),
  ],
);

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    addressLine: text("address_line").notNull(),
    addressNotes: text("address_notes"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    phone: text("phone"),
    /** Copiada de la ciudad al crear la sucursal: los horarios se interpretan en esta zona. */
    timezone: text("timezone").notNull(),
    acceptsPickup: boolean("accepts_pickup").notNull().default(true),
    acceptsDelivery: boolean("accepts_delivery").notNull().default(false),
    /** Pedidos programados (ADR 0011): franjas de 30 min dentro del horario. */
    schedulingEnabled: boolean("scheduling_enabled").notNull().default(false),
    /** Anticipación mínima en minutos (fecha de corte). */
    scheduleLeadMinutes: smallint("schedule_lead_minutes").notNull().default(60),
    /** Hasta cuántos días adelante. */
    scheduleMaxDays: smallint("schedule_max_days").notNull().default(3),
    /** Pedidos programados por franja; null = sin límite. */
    slotCapacity: smallint("slot_capacity"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("branches_merchant_idx").on(t.merchantId),
    index("branches_city_idx").on(t.cityId),
    check(
      "branches_lat_lng_check",
      sql`(${t.lat} IS NULL AND ${t.lng} IS NULL) OR (${t.lat} BETWEEN -90 AND 90 AND ${t.lng} BETWEEN -180 AND 180)`,
    ),
    check(
      "branches_scheduling_check",
      sql`${t.scheduleLeadMinutes} BETWEEN 15 AND 2880 AND ${t.scheduleMaxDays} BETWEEN 1 AND 14 AND (${t.slotCapacity} IS NULL OR ${t.slotCapacity} >= 1)`,
    ),
  ],
);

/**
 * Horario semanal: uno o más rangos por día. Minutos desde medianoche;
 * si closes_at <= opens_at el rango cruza la medianoche (ver @pedilo/domain schedule).
 */
export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(),
    opensAt: smallint("opens_at").notNull(),
    closesAt: smallint("closes_at").notNull(),
  },
  (t) => [
    index("business_hours_branch_idx").on(t.branchId, t.weekday),
    check("business_hours_weekday_check", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("business_hours_range_check", sql`${t.opensAt} BETWEEN 0 AND 1440 AND ${t.closesAt} BETWEEN 0 AND 1440`),
  ],
);

/**
 * Cierres excepcionales (SPEC §15 special_hours, ADR 0018): días completos de cierre en la fecha
 * local de la sucursal (feriados, vacaciones). Ganan al horario semanal.
 */
export const branchClosures = pgTable(
  "branch_closures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    /** Lo ve el cliente ("Feriado", "Vacaciones"). */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("branch_closures_branch_idx").on(t.branchId, t.endsOn),
    check("branch_closures_range_check", sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * Zonas de envío simples: nombre + descripción (barrios incluidos), tarifa fija y pedido mínimo.
 * Polígonos/radios quedan como decisión abierta (SPEC §17).
 */
export const deliveryZones = pgTable(
  "delivery_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    feeMinor: integer("fee_minor").notNull(),
    minOrderMinor: integer("min_order_minor").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("delivery_zones_branch_idx").on(t.branchId),
    check("delivery_zones_amounts_check", sql`${t.feeMinor} >= 0 AND ${t.minOrderMinor} >= 0`),
  ],
);

export type MerchantRow = typeof merchants.$inferSelect;
export type BranchRow = typeof branches.$inferSelect;
export type BusinessHoursRow = typeof businessHours.$inferSelect;
export type DeliveryZoneRow = typeof deliveryZones.$inferSelect;
export type BranchClosureRow = typeof branchClosures.$inferSelect;
