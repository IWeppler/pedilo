import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";
// Solo para FKs (excepción documentada en ARCHITECTURE §4).
import { categories } from "../catalog/schema";
import { merchants } from "../merchants/schema";

/** Menú del comercio (ADR 0006): secciones propias y productos con variantes y modificadores. */

export const menuSections = pgTable(
  "menu_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("menu_sections_merchant_idx").on(t.merchantId, t.sortOrder)],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => menuSections.id, { onDelete: "set null" }),
    /** Categoría global de producto (taxonomía del admin), opcional, para búsqueda. */
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Precio si no tiene variantes (centavos). Con variantes, manda el precio de la variante. */
    priceMinor: integer("price_minor").notNull(),
    /** Pausado = visible pero no se puede pedir (US-203). */
    available: boolean("available").notNull().default(true),
    /** Archivado = no aparece en el menú público. Los productos no se borran. */
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Foto (ruta en el almacenamiento, ADR 0017). */
    imagePath: text("image_path"),
    ...timestamps,
  },
  (t) => [
    index("products_merchant_idx").on(t.merchantId, t.sectionId, t.sortOrder),
    check("products_price_check", sql`${t.priceMinor} >= 0`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceMinor: integer("price_minor").notNull(),
    available: boolean("available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("product_variants_product_idx").on(t.productId, t.sortOrder),
    check("product_variants_price_check", sql`${t.priceMinor} >= 0`),
  ],
);

export const modifierGroups = pgTable(
  "modifier_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    minSelect: smallint("min_select").notNull().default(0),
    maxSelect: smallint("max_select").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("modifier_groups_product_idx").on(t.productId, t.sortOrder),
    check("modifier_groups_range_check", sql`${t.minSelect} >= 0 AND ${t.maxSelect} >= 1 AND ${t.minSelect} <= ${t.maxSelect}`),
  ],
);

export const modifiers = pgTable(
  "modifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceDeltaMinor: integer("price_delta_minor").notNull().default(0),
    maxQuantity: smallint("max_quantity").notNull().default(1),
    available: boolean("available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("modifiers_group_idx").on(t.groupId, t.sortOrder),
    check("modifiers_values_check", sql`${t.priceDeltaMinor} >= 0 AND ${t.maxQuantity} >= 1`),
  ],
);

export type MenuSectionRow = typeof menuSections.$inferSelect;
export type ProductRow = typeof products.$inferSelect;
export type ProductVariantRow = typeof productVariants.$inferSelect;
export type ModifierGroupRow = typeof modifierGroups.$inferSelect;
export type ModifierRow = typeof modifiers.$inferSelect;
