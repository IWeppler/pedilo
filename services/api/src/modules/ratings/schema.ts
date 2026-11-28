import { sql } from "drizzle-orm";
import { check, index, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { merchants } from "../merchants/schema";

/**
 * Calificación de un comercio por quien hizo el pedido (SPEC §11.3, ADR 0031). Una por pedido. El
 * comentario lo ven el comercio y Pedilo, no los demás clientes. `order_id` es un dato (el pedido es
 * de otro módulo); `order_code` se copia para mostrarlo en el panel.
 */
export const merchantRatings = pgTable(
  "merchant_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").notNull(),
    orderCode: text("order_code").notNull(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    customerUserId: uuid("customer_user_id").notNull(),
    stars: smallint("stars").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_ratings_order_unique").on(t.orderId),
    index("merchant_ratings_merchant_idx").on(t.merchantId, t.createdAt),
    check("merchant_ratings_stars_check", sql`${t.stars} BETWEEN 1 AND 5`),
    check("merchant_ratings_comment_check", sql`${t.comment} IS NULL OR char_length(${t.comment}) <= 500`),
  ],
);

export type MerchantRatingRow = typeof merchantRatings.$inferSelect;
