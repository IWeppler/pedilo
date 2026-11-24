import type { MerchantCategory } from "@pedilo/domain";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";

export const CategoryKind = {
  /** Rubro del comercio (Gastronomía, Kiosco, Supermercado…). Define el tope de comisión. */
  MERCHANT: "MERCHANT",
  /** Taxonomía global de productos, para catálogo canónico y búsqueda. */
  PRODUCT: "PRODUCT",
} as const;
export type CategoryKind = (typeof CategoryKind)[keyof typeof CategoryKind];

/**
 * Categorías administradas por Pedilo (SPEC §15). Las secciones del menú de cada comercio
 * ("Pizzas", "Bebidas") son otra cosa y vivirán con el catálogo del comercio.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
    kind: text("kind").$type<CategoryKind>().notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Solo rubros (MERCHANT): a qué categoría de comisión corresponde (SPEC §6.2, topes por rubro). */
    commissionCategory: text("commission_category").$type<MerchantCategory>(),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("categories_kind_slug_unique").on(t.kind, t.slug),
    index("categories_parent_idx").on(t.parentId),
    check("categories_kind_check", sql`${t.kind} IN ('MERCHANT', 'PRODUCT')`),
    check(
      "categories_commission_category_check",
      sql`${t.commissionCategory} IS NULL OR (${t.kind} = 'MERCHANT' AND ${t.commissionCategory} IN ('GASTRONOMY', 'KIOSK', 'SUPERMARKET', 'ELECTRONICS', 'ENTREPRENEUR'))`,
    ),
    check("categories_not_own_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
