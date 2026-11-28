/**
 * Datos iniciales: la ciudad piloto, los rubros con su categoría de comisión y las categorías
 * de producto (dos niveles: grupo y categoría). Sirve para desarrollo y para armar un entorno
 * nuevo. Idempotente: lo que ya existe (por slug) no se toca, así que lo editado desde el panel
 * de admin se conserva.
 */
import { MerchantCategory } from "@pedilo/domain";
import { and, eq, isNotNull, sql } from "drizzle-orm";

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

/** Grupo → categorías. El slug sale del nombre; los de categoría llevan prefijo si se repetirían. */
const productCategories: { name: string; slug: string; children: [name: string, slug: string][] }[] = [
  {
    name: "Comidas",
    slug: "comidas",
    children: [
      ["Pizzas", "pizzas"],
      ["Empanadas", "empanadas"],
      ["Hamburguesas", "hamburguesas"],
      ["Lomitos y sándwiches", "lomitos-y-sandwiches"],
      ["Milanesas", "milanesas"],
      ["Minutas", "minutas"],
      ["Parrilla", "parrilla"],
      ["Pastas", "pastas"],
      ["Ensaladas y opciones livianas", "ensaladas"],
      ["Saludable", "saludable"],
      ["Sushi", "sushi"],
      ["Comida árabe", "comida-arabe"],
      ["Platos del día", "platos-del-dia"],
      ["Guarniciones", "guarniciones"],
    ],
  },
  {
    name: "Dulces y cafetería",
    slug: "dulces-y-cafeteria",
    children: [
      ["Cafetería", "cafeteria"],
      ["Panadería y facturas", "panaderia"],
      ["Tortas y pastelería", "pasteleria"],
      ["Postres", "postres"],
      ["Helados", "helados"],
    ],
  },
  {
    name: "Bebidas",
    slug: "bebidas",
    children: [
      ["Gaseosas y aguas", "gaseosas-y-aguas"],
      ["Jugos", "jugos"],
      ["Cervezas", "cervezas"],
      ["Vinos", "vinos"],
      ["Bebidas espirituosas", "espirituosas"],
      ["Energizantes", "energizantes"],
    ],
  },
  {
    name: "Kiosco",
    slug: "kiosco",
    children: [
      ["Golosinas", "golosinas"],
      ["Snacks", "snacks"],
      ["Galletitas", "galletitas"],
      ["Helados envasados", "helados-envasados"],
    ],
  },
  {
    name: "Almacén y supermercado",
    slug: "almacen-y-supermercado",
    children: [
      ["Almacén", "almacen"],
      ["Lácteos y fiambres", "lacteos-y-fiambres"],
      ["Carnes", "carnes"],
      ["Frutas y verduras", "frutas-y-verduras"],
      ["Panificados", "panificados"],
      ["Congelados", "congelados"],
      ["Limpieza", "limpieza"],
      ["Perfumería e higiene", "perfumeria"],
      ["Mascotas", "mascotas"],
      ["Bebés", "bebes"],
    ],
  },
  {
    name: "Electrónica",
    slug: "electronica-productos",
    children: [
      ["Celulares y accesorios", "celulares"],
      ["Computación", "computacion"],
      ["Audio y video", "audio-y-video"],
      ["Pequeños electrodomésticos", "electrodomesticos"],
      ["Cables, cargadores y pilas", "cables-y-cargadores"],
    ],
  },
  {
    name: "Emprendimientos",
    slug: "emprendimientos",
    children: [
      ["Ropa y accesorios", "ropa-y-accesorios"],
      ["Artesanías y decoración", "artesanias"],
      ["Regalos", "regalos"],
      ["Cosmética natural", "cosmetica-natural"],
      ["Comida casera", "comida-casera"],
    ],
  },
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

  let productCount = 0;
  for (const [groupIndex, group] of productCategories.entries()) {
    await db
      .insert(categories)
      .values({ kind: "PRODUCT", name: group.name, slug: group.slug, sortOrder: (groupIndex + 1) * 10 })
      .onConflictDoNothing({ target: [categories.kind, categories.slug] });
    const [parent] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.kind, "PRODUCT"), eq(categories.slug, group.slug)));
    if (!parent) throw new Error(`No se pudo crear el grupo ${group.slug}`);

    await db
      .insert(categories)
      .values(
        group.children.map(([name, slug], i) => ({
          kind: "PRODUCT" as const,
          name,
          slug,
          parentId: parent.id,
          sortOrder: (i + 1) * 10,
        })),
      )
      .onConflictDoNothing({ target: [categories.kind, categories.slug] });
    productCount += 1 + group.children.length;
  }

  // Tipos de comida del inicio de la app (ADR 0027): solo si todavía no se eligieron.
  const foodTypes = ["hamburguesas", "pizzas", "snacks", "bebidas", "postres", "saludable"];
  const [{ featured } = { featured: 0 }] = await db
    .select({ featured: sql<number>`count(*)::int` })
    .from(categories)
    .where(and(eq(categories.kind, "PRODUCT"), isNotNull(categories.featuredOrder)));
  if (featured === 0) {
    for (const [i, slug] of foodTypes.entries()) {
      await db
        .update(categories)
        .set({ featuredOrder: (i + 1) * 10 })
        .where(and(eq(categories.kind, "PRODUCT"), eq(categories.slug, slug)));
    }
  }

  console.log(
    `Seed aplicado: ciudad Tostado, ${merchantCategories.length} rubros y ${productCount} categorías de producto (${productCategories.length} grupos).`,
  );
} finally {
  await close();
}
