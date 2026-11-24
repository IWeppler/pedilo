/**
 * Datos iniciales para desarrollo: la ciudad piloto y los rubros con su categoría de comisión.
 * Idempotente: se puede correr varias veces.
 */
import { MerchantCategory } from "@pedilo/domain";

import { loadConfig } from "../config";
import { categories, cities } from "./schema";
import { createDb } from "./client";

const { db, close } = createDb(loadConfig().databaseUrl);

const merchantCategories = [
  { name: "Gastronomía", slug: "gastronomia", commissionCategory: MerchantCategory.GASTRONOMY, sortOrder: 10 },
  { name: "Kioscos", slug: "kioscos", commissionCategory: MerchantCategory.KIOSK, sortOrder: 20 },
  { name: "Supermercados", slug: "supermercados", commissionCategory: MerchantCategory.SUPERMARKET, sortOrder: 30 },
  { name: "Electrónica", slug: "electronica", commissionCategory: MerchantCategory.ELECTRONICS, sortOrder: 40 },
  { name: "Emprendedores", slug: "emprendedores", commissionCategory: MerchantCategory.ENTREPRENEUR, sortOrder: 50 },
];

try {
  await db
    .insert(cities)
    .values({ name: "Tostado", slug: "tostado", province: "Santa Fe" })
    .onConflictDoNothing({ target: cities.slug });

  await db
    .insert(categories)
    .values(merchantCategories.map((c) => ({ ...c, kind: "MERCHANT" as const })))
    .onConflictDoNothing({ target: [categories.kind, categories.slug] });

  console.log("Seed aplicado: ciudad Tostado y 5 rubros.");
} finally {
  await close();
}
