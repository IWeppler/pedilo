import { timestamp } from "drizzle-orm/pg-core";

/** Columnas created_at / updated_at comunes a todas las tablas. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
