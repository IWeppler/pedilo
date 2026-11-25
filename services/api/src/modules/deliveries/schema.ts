import type { CourierStatus, DeliverySource, DeliveryStatus, Vehicle } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4). `orders` NO se referencia: el reparto
// no depende del pedido (SPEC §9.0); `order_id` es un dato, no una FK.
import { cities } from "../geography/schema";
import { users } from "../identity/schema";
import { branches, merchants } from "../merchants/schema";

/** Repartidor independiente (SPEC §9.2). Un usuario, un perfil. Lo aprueba un admin. */
export const courierProfiles = pgTable(
  "courier_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    phone: text("phone").notNull(),
    vehicle: text("vehicle").$type<Vehicle>().notNull(),
    /** Ciudad donde trabaja: solo ve ofertas de ahí. */
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    /** No ve ofertas que paguen menos que esto (centavos). */
    minFeeMinor: integer("min_fee_minor").notNull().default(0),
    status: text("status").$type<CourierStatus>().notNull().default("PENDING_REVIEW"),
    statusReason: text("status_reason"),
    /** Disponible para recibir ofertas. */
    available: boolean("available").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("courier_profiles_user_unique").on(t.userId),
    index("courier_profiles_city_idx").on(t.cityId, t.status),
    check("courier_profiles_status_check", sql`${t.status} IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')`),
    check("courier_profiles_vehicle_check", sql`${t.vehicle} IN ('WALK', 'BIKE', 'MOTO', 'CAR')`),
    check("courier_profiles_min_fee_check", sql`${t.minFeeMinor} >= 0`),
  ],
);

/**
 * Servicio logístico (SPEC §9.0): agregado propio con snapshots de lo que necesita. Nunca lee el
 * pedido; se comunica con pedidos por comandos y eventos dentro del proceso.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").$type<DeliverySource>().notNull(),
    /** Pedido de origen (solo con source = ORDER). Dato, no FK. */
    orderId: uuid("order_id"),
    /** Para mostrar ("P-7K3Q"). */
    reference: text("reference").notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    cityId: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    status: text("status").$type<DeliveryStatus>().notNull(),
    /** Sube en cada cambio: control optimista para aceptaciones y estados. */
    version: integer("version").notNull().default(1),

    pickupName: text("pickup_name").notNull(),
    pickupAddress: text("pickup_address").notNull(),
    pickupPhone: text("pickup_phone"),
    /** Zona aproximada: lo único del destino que se ve antes de aceptar. */
    dropoffArea: text("dropoff_area").notNull(),
    dropoffAddress: text("dropoff_address").notNull(),
    dropoffNotes: text("dropoff_notes"),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    packageDescription: text("package_description").notNull(),

    /** Lo que el comercio le paga al repartidor (fuera de Pedilo). */
    courierFeeMinor: integer("courier_fee_minor").notNull(),
    tipMinor: integer("tip_minor").notNull().default(0),
    /** Efectivo que el repartidor cobra al cliente y le debe al comercio. */
    cashToCollectMinor: integer("cash_to_collect_minor").notNull().default(0),

    courierId: uuid("courier_id").references(() => courierProfiles.id, { onDelete: "restrict" }),
    offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    statusReason: text("status_reason"),
    ...timestamps,
  },
  (t) => [
    // Un pedido tiene a lo sumo un delivery activo (los cancelados no cuentan).
    uniqueIndex("deliveries_order_active_unique").on(t.orderId).where(sql`${t.orderId} IS NOT NULL AND ${t.status} <> 'CANCELLED'`),
    index("deliveries_offers_idx").on(t.cityId, t.offerExpiresAt).where(sql`${t.status} = 'OFFERED'`),
    index("deliveries_courier_idx").on(t.courierId, t.updatedAt),
    index("deliveries_merchant_idx").on(t.merchantId, t.createdAt),
    check("deliveries_source_check", sql`${t.source} IN ('ORDER', 'MERCHANT_REQUEST')`),
    check("deliveries_order_check", sql`${t.source} <> 'ORDER' OR ${t.orderId} IS NOT NULL`),
    check("deliveries_amounts_check", sql`${t.courierFeeMinor} >= 0 AND ${t.tipMinor} >= 0 AND ${t.cashToCollectMinor} >= 0`),
    check(
      "deliveries_courier_check",
      sql`${t.status} NOT IN ('ASSIGNED', 'ARRIVING_PICKUP', 'PICKED_UP', 'ARRIVING_DROPOFF', 'DELIVERED') OR ${t.courierId} IS NOT NULL`,
    ),
  ],
);

/** Historial inmutable del delivery. `event_id` deduplica reintentos de la app (SPEC §9.3). */
export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<DeliveryStatus>(),
    toStatus: text("to_status").$type<DeliveryStatus>().notNull(),
    actorType: text("actor_type").$type<"MERCHANT" | "COURIER" | "SYSTEM">().notNull(),
    actorUserId: uuid("actor_user_id"),
    courierId: uuid("courier_id"),
    reason: text("reason"),
    eventId: text("event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("delivery_events_delivery_idx").on(t.deliveryId, t.createdAt),
    uniqueIndex("delivery_events_event_unique").on(t.eventId).where(sql`${t.eventId} IS NOT NULL`),
  ],
);

/** Ofertas que un repartidor rechazó: no se le vuelven a mostrar (rechazar no penaliza). */
export const deliveryDeclines = pgTable(
  "delivery_declines",
  {
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    courierId: uuid("courier_id")
      .notNull()
      .references(() => courierProfiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deliveryId, t.courierId] })],
);

export type CourierProfileRow = typeof courierProfiles.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type DeliveryEventRow = typeof deliveryEvents.$inferSelect;
