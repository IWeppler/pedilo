import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "../../lib/timestamps";

export const cities = pgTable(
  "cities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    province: text("province").notNull(),
    country: text("country").notNull().default("AR"),
    /** Zona horaria IANA. Santa Fe usa America/Argentina/Cordoba. */
    timezone: text("timezone").notNull().default("America/Argentina/Cordoba"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("cities_slug_unique").on(t.slug)],
);

export type CityRow = typeof cities.$inferSelect;
