import type { DiscountType, PromotionKind } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { products } from "../menu/schema";
import { merchants } from "../merchants/schema";

/**
 * Promociones del comercio (SPEC §12.4, ADR 0030): ofertas automáticas y cupones con código. Las
 * paga el comercio. No son acumulables: el pedido lleva el mayor descuento.
 */
export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PromotionKind>().notNull(),
    /** Solo cupones: el código que escribe el cliente (mayúsculas, sin espacios). */
    code: text("code"),
    /** Lo que ve el cliente: «20% en pizzas», «Martes de empanadas». */
    title: text("title").notNull(),
    discountType: text("discount_type").$type<DiscountType>().notNull(),
    /** Porcentaje (1–90) o monto en centavos. */
    value: integer("value").notNull(),
    /** Todo el menú, o solo los productos de `promotion_products`. */
    allProducts: boolean("all_products").notNull().default(true),
    minSubtotalMinor: integer("min_subtotal_minor").notNull().default(0),
    /** Tope del descuento de un porcentaje (centavos). */
    maxDiscountMinor: integer("max_discount_minor"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Cupo total de usos; null = sin límite. */
    maxRedemptions: integer("max_redemptions"),
    /** Usos por cliente; null = sin límite. Los cupones vienen con 1. */
    perCustomerLimit: integer("per_customer_limit"),
    /** Usos vigentes (sin contar los de pedidos cancelados). Sube y baja en la misma transacción. */
    redemptionsCount: integer("redemptions_count").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("promotions_merchant_idx").on(t.merchantId, t.active),
    uniqueIndex("promotions_code_unique").on(t.merchantId, t.code).where(sql`${t.code} IS NOT NULL`),
    check("promotions_kind_check", sql`${t.kind} IN ('OFFER', 'COUPON')`),
    check("promotions_code_check", sql`(${t.kind} = 'COUPON') = (${t.code} IS NOT NULL)`),
    check("promotions_discount_type_check", sql`${t.discountType} IN ('PERCENT', 'FIXED')`),
    check(
      "promotions_value_check",
      sql`(${t.discountType} = 'PERCENT' AND ${t.value} BETWEEN 1 AND 90) OR (${t.discountType} = 'FIXED' AND ${t.value} > 0)`,
    ),
    check("promotions_limits_check", sql`${t.minSubtotalMinor} >= 0 AND (${t.maxDiscountMinor} IS NULL OR ${t.maxDiscountMinor} > 0)`),
    check(
      "promotions_redemptions_check",
      sql`${t.redemptionsCount} >= 0 AND (${t.maxRedemptions} IS NULL OR ${t.maxRedemptions} > 0) AND (${t.perCustomerLimit} IS NULL OR ${t.perCustomerLimit} > 0)`,
    ),
    check("promotions_dates_check", sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Productos de una promo que no es para todo el menú. */
export const promotionProducts = pgTable(
  "promotion_products",
  {
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.promotionId, t.productId] })],
);

/**
 * Cada uso de una promo en un pedido. `REVERSED` si el pedido se canceló, se rechazó o venció: el uso
 * vuelve al cupo. `order_id` es un dato (el pedido es de otro módulo).
 */
export const promotionRedemptions = pgTable(
  "promotion_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").notNull(),
    customerUserId: uuid("customer_user_id"),
    discountMinor: integer("discount_minor").notNull(),
    status: text("status").$type<"APPLIED" | "REVERSED">().notNull().default("APPLIED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("promotion_redemptions_order_unique").on(t.orderId),
    index("promotion_redemptions_customer_idx").on(t.promotionId, t.customerUserId),
    check("promotion_redemptions_status_check", sql`${t.status} IN ('APPLIED', 'REVERSED')`),
    check("promotion_redemptions_discount_check", sql`${t.discountMinor} > 0`),
  ],
);

export type PromotionRow = typeof promotions.$inferSelect;
export type PromotionRedemptionRow = typeof promotionRedemptions.$inferSelect;
