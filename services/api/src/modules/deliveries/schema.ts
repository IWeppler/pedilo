import type { CourierStatus, DeliverySource, DeliveryStatus, Vehicle } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    /** Punto exacto de entrega si el cliente lo marcó (ADR 0023). Como la dirección: solo asignado. */
    dropoffLat: doublePrecision("dropoff_lat"),
    dropoffLng: doublePrecision("dropoff_lng"),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    packageDescription: text("package_description").notNull(),

    /** Lo que el comercio le paga al repartidor (fuera de Pedilo). */
    courierFeeMinor: integer("courier_fee_minor").notNull(),
    tipMinor: integer("tip_minor").notNull().default(0),
    /** Efectivo que el repartidor cobra al cliente y le debe al comercio. */
    cashToCollectMinor: integer("cash_to_collect_minor").notNull().default(0),

    courierId: uuid("courier_id").references(() => courierProfiles.id, { onDelete: "restrict" }),
    /**
     * Prueba de entrega (SPEC §9.2, ADR 0016): el repartidor ingresa el PIN que tiene el cliente.
     * Lo ven el cliente y el comercio; el repartidor nunca.
     */
    pinRequired: boolean("pin_required").notNull().default(false),
    dropoffPin: text("dropoff_pin"),
    pinAttempts: smallint("pin_attempts").notNull().default(0),
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
    check(
      "deliveries_dropoff_location_check",
      sql`(${t.dropoffLat} IS NULL AND ${t.dropoffLng} IS NULL) OR (${t.dropoffLat} BETWEEN -90 AND 90 AND ${t.dropoffLng} BETWEEN -180 AND 180)`,
    ),
    check("deliveries_pin_check", sql`NOT ${t.pinRequired} OR ${t.dropoffPin} ~ '^[0-9]{4}$'`),
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

/**
 * Última ubicación del repartidor mientras tiene un reparto en curso (ADR 0022). Una fila por
 * repartidor, sin historial: se pisa con cada punto y se borra cuando no le queda ningún reparto
 * activo (SPEC §9.2: ubicación con consentimiento y retención limitada).
 */
export const courierLocations = pgTable(
  "courier_locations",
  {
    courierId: uuid("courier_id")
      .primaryKey()
      .references(() => courierProfiles.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    /** Precisión informada por el GPS, en metros. */
    accuracyM: integer("accuracy_m"),
    /** Cuándo se tomó el punto, en hora del servidor (el teléfono manda la antigüedad, no su reloj). */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("courier_locations_lat_lng_check", sql`${t.lat} BETWEEN -90 AND 90 AND ${t.lng} BETWEEN -180 AND 180`),
    check("courier_locations_accuracy_check", sql`${t.accuracyM} IS NULL OR ${t.accuracyM} >= 0`),
  ],
);

export const CourierMerchantEntryKind = {
  /** El comercio le debe al repartidor el pago del envío (+ propina). */
  DELIVERY_FEE: "DELIVERY_FEE",
  /** El repartidor cobró efectivo del cliente: se lo debe al comercio. */
  CASH_COLLECTED: "CASH_COLLECTED",
  /** Pago registrado por el comercio (en cualquier sentido) o corrección. */
  PAYMENT: "PAYMENT",
} as const;
export type CourierMerchantEntryKind = (typeof CourierMerchantEntryKind)[keyof typeof CourierMerchantEntryKind];

/**
 * Cuenta entre un comercio y un repartidor (SPEC §8.3, §9.2): Pedilo registra, no custodia fondos.
 * Positivo = el comercio le debe al repartidor; negativo = el repartidor le debe al comercio.
 * Append-only: el saldo es la suma.
 */
export const courierMerchantEntries = pgTable(
  "courier_merchant_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    courierId: uuid("courier_id")
      .notNull()
      .references(() => courierProfiles.id, { onDelete: "restrict" }),
    deliveryId: uuid("delivery_id").references(() => deliveries.id, { onDelete: "restrict" }),
    kind: text("kind").$type<CourierMerchantEntryKind>().notNull(),
    amountMinor: integer("amount_minor").notNull(),
    description: text("description").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("courier_merchant_entries_pair_idx").on(t.merchantId, t.courierId, t.createdAt),
    index("courier_merchant_entries_courier_idx").on(t.courierId, t.createdAt),
    // Un reparto genera a lo sumo un asiento de cada tipo automático.
    uniqueIndex("courier_merchant_entries_delivery_unique")
      .on(t.deliveryId, t.kind)
      .where(sql`${t.deliveryId} IS NOT NULL AND ${t.kind} <> 'PAYMENT'`),
    check("courier_merchant_entries_kind_check", sql`${t.kind} IN ('DELIVERY_FEE', 'CASH_COLLECTED', 'PAYMENT')`),
    check("courier_merchant_entries_amount_check", sql`${t.amountMinor} <> 0`),
  ],
);

export type CourierMerchantEntryRow = typeof courierMerchantEntries.$inferSelect;
export type CourierLocationRow = typeof courierLocations.$inferSelect;
export type CourierProfileRow = typeof courierProfiles.$inferSelect;
export type DeliveryRow = typeof deliveries.$inferSelect;
export type DeliveryEventRow = typeof deliveryEvents.$inferSelect;
