import type { CommissionResult, FulfillmentType, MerchantCategory, OrderStatus, PaymentMethod, PaymentStatus, PlanCode } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { branches, merchants } from "../merchants/schema";

/**
 * Pedidos (SPEC §7, ADR 0007). Todo lo que el cliente vio al pedir se copia (snapshot):
 * nombres, precios, zona y datos del comercio. Editar el menú no cambia pedidos existentes.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Código corto para hablar del pedido ("P-7K3Q"). Solo para mostrar, no es único. */
    code: text("code").notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "restrict" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    merchantName: text("merchant_name").notNull(),
    merchantSlug: text("merchant_slug").notNull(),
    branchName: text("branch_name").notNull(),
    branchAddress: text("branch_address").notNull(),

    status: text("status").$type<OrderStatus>().notNull(),
    /** Motivo del último rechazo/cancelación/falla (lo ve el cliente). */
    statusReason: text("status_reason"),
    fulfillmentType: text("fulfillment_type").$type<FulfillmentType>().notNull(),
    paymentMethod: text("payment_method").$type<PaymentMethod>().notNull(),
    paymentStatus: text("payment_status").$type<PaymentStatus>().notNull(),

    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    /** Usuario autenticado que hizo el pedido; null = invitado (ADR 0007). */
    customerUserId: uuid("customer_user_id"),

    deliveryZoneId: uuid("delivery_zone_id"),
    deliveryZoneName: text("delivery_zone_name"),
    deliveryAddressLine: text("delivery_address_line"),
    deliveryAddressNotes: text("delivery_address_notes"),
    notes: text("notes"),

    subtotalMinor: integer("subtotal_minor").notNull(),
    deliveryFeeMinor: integer("delivery_fee_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),

    idempotencyKey: text("idempotency_key").notNull(),

    /** Pedido programado: inicio de la franja de 30 min (ADR 0011). Null = lo antes posible. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** Transferencia: datos del comercio al momento de pedir (snapshot). */
    transferDetails: jsonb("transfer_details").$type<TransferDetails>(),
    /** El comercio confirmó que cobró (efectivo) o que le llegó la transferencia. Nunca automático. */
    paymentConfirmedAt: timestamp("payment_confirmed_at", { withTimezone: true }),
    paymentConfirmedBy: uuid("payment_confirmed_by"),

    /**
     * Comisión Pedilo calculada al crear el pedido (SPEC §6.2, ADR 0012) e inmutable: si después
     * cambia el plan o el pricing, este pedido no cambia. Se devenga en el ledger al completarse.
     */
    pricingVersionId: text("pricing_version_id"),
    commissionPlan: text("commission_plan").$type<PlanCode>(),
    commissionCategory: text("commission_category").$type<MerchantCategory>(),
    commissionBasisMinor: integer("commission_basis_minor"),
    commissionMinor: integer("commission_minor"),
    commissionDetail: jsonb("commission_detail").$type<CommissionResult>(),

    /**
     * Hasta cuándo el comercio puede aceptar (snapshot al crear). Vencido sin respuesta, el worker
     * lo pasa a EXPIRED (SPEC §7.1 paso 7). Null en pedidos anteriores a esta columna.
     */
    acceptDeadlineAt: timestamp("accept_deadline_at", { withTimezone: true }),
    /** Primera vez que el comercio lo marcó como visto (o lo aceptó/rechazó). Apaga la alarma (SPEC §10). */
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_idempotency_key_unique").on(t.idempotencyKey),
    index("orders_merchant_status_idx").on(t.merchantId, t.status, t.createdAt),
    index("orders_branch_idx").on(t.branchId, t.createdAt),
    // Barrido de vencimientos: solo pedidos esperando confirmación.
    index("orders_accept_deadline_idx").on(t.acceptDeadlineAt).where(sql`${t.status} = 'PLACED'`),
    // Cupos por franja de los pedidos programados.
    index("orders_branch_slot_idx").on(t.branchId, t.scheduledFor).where(sql`${t.scheduledFor} IS NOT NULL`),
    check("orders_payment_method_check", sql`${t.paymentMethod} IN ('CASH', 'TRANSFER', 'MERCADO_PAGO')`),
    check("orders_transfer_details_check", sql`${t.paymentMethod} <> 'TRANSFER' OR ${t.transferDetails} IS NOT NULL`),
    check("orders_fulfillment_check", sql`${t.fulfillmentType} IN ('PICKUP', 'DELIVERY')`),
    check(
      "orders_delivery_address_check",
      sql`${t.fulfillmentType} = 'PICKUP' OR (${t.deliveryAddressLine} IS NOT NULL AND ${t.deliveryZoneName} IS NOT NULL)`,
    ),
    check(
      "orders_amounts_check",
      sql`${t.subtotalMinor} >= 0 AND ${t.deliveryFeeMinor} >= 0 AND ${t.totalMinor} = ${t.subtotalMinor} + ${t.deliveryFeeMinor}`,
    ),
  ],
);

export interface TransferDetails {
  alias: string | null;
  cbu: string | null;
  holder: string;
}

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id"),
    productName: text("product_name").notNull(),
    variantId: uuid("variant_id"),
    variantName: text("variant_name"),
    /** Precio unitario final (variante + opciones). */
    unitPriceMinor: integer("unit_price_minor").notNull(),
    quantity: smallint("quantity").notNull(),
    totalMinor: integer("total_minor").notNull(),
    notes: text("notes"),
    sortOrder: smallint("sort_order").notNull().default(0),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId, t.sortOrder),
    check("order_items_amounts_check", sql`${t.quantity} >= 1 AND ${t.totalMinor} = ${t.unitPriceMinor} * ${t.quantity}`),
  ],
);

export const orderItemOptions = pgTable(
  "order_item_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id, { onDelete: "cascade" }),
    modifierId: uuid("modifier_id"),
    groupName: text("group_name").notNull(),
    name: text("name").notNull(),
    quantity: smallint("quantity").notNull(),
    priceDeltaMinor: integer("price_delta_minor").notNull(),
  },
  (t) => [index("order_item_options_item_idx").on(t.orderItemId)],
);

export const OrderActorType = { CUSTOMER: "CUSTOMER", MERCHANT: "MERCHANT", SYSTEM: "SYSTEM" } as const;
export type OrderActorType = (typeof OrderActorType)[keyof typeof OrderActorType];

/** Historial inmutable de cambios de estado (SPEC §15 order_events). */
export const orderEvents = pgTable(
  "order_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<OrderStatus>(),
    toStatus: text("to_status").$type<OrderStatus>().notNull(),
    actorType: text("actor_type").$type<OrderActorType>().notNull(),
    actorUserId: uuid("actor_user_id"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt)],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderItemOptionRow = typeof orderItemOptions.$inferSelect;
export type OrderEventRow = typeof orderEvents.$inferSelect;
