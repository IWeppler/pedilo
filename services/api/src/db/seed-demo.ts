/**
 * Datos de demo para desarrollar la UI: comercios con menús completos, dueños y pedidos.
 *
 *   npm run db:seed:demo -w @pedilo/api
 *
 * Usa los SERVICIOS de la API (no inserts directos): todo pasa por las mismas validaciones
 * que un alta real. Idempotente: si un comercio ya existe (por slug), se saltea.
 * Los datos están en `demo-data.ts`.
 */
import { formatTime, parseTime } from "@pedilo/domain";
import { and, eq } from "drizzle-orm";

import { loadConfig } from "../config";
import { approveMerchant, createBranch, createZone, registerMerchant, replaceBranchHours, submitMerchant } from "../modules/merchants/service";
import { createProduct, createSection, getPublicMerchantMenu } from "../modules/menu/service";
import { createOrder, transitionMerchantOrder } from "../modules/orders/service";
import { devUserEmail, devUserId } from "../scripts/dev-users";
import { createDb } from "./client";
import { slugify } from "../lib/slug";
import { DEMO_MERCHANTS, DEMO_ORDERS, type DemoMerchant } from "./demo-data";
import { categories, cities, merchants, users } from "./schema";

const config = loadConfig();
if (config.env === "production") {
  console.error("db:seed:demo no se corre en producción.");
  process.exit(1);
}
const { db, close } = createDb(config.databaseUrl);
const pesos = (n: number) => Math.round(n * 100);
const actor = (name: string) => ({ userId: devUserId(name), requestId: "seed-demo" });

/** CUIT válido a partir de 10 dígitos base (calcula el verificador; si da 10, ajusta la base). */
function cuit(base: string): string {
  const W = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (let bump = 0; bump < 10; bump++) {
    const digits = (BigInt(base) + BigInt(bump)).toString().padStart(10, "0");
    const sum = W.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
    const mod = 11 - (sum % 11);
    const check = mod === 11 ? 0 : mod;
    if (check !== 10) return `${digits}${check}`;
  }
  throw new Error(`No se pudo generar CUIT para ${base}`);
}

async function ensureUser(name: string, admin = false) {
  await db
    .insert(users)
    .values({ id: devUserId(name), email: devUserEmail(name), ...(admin && { platformRole: "ADMIN" as const }) })
    .onConflictDoUpdate({ target: users.id, set: admin ? { platformRole: "ADMIN" } : { email: devUserEmail(name) } });
}

async function ensureBase() {
  await db
    .insert(cities)
    .values([
      { name: "Tostado", slug: "tostado", province: "Santa Fe" },
      { name: "Gálvez", slug: "galvez", province: "Santa Fe" },
    ])
    .onConflictDoNothing({ target: cities.slug });
  const rubros = [
    ["Gastronomía", "gastronomia", "GASTRONOMY", 10],
    ["Kioscos", "kioscos", "KIOSK", 20],
    ["Supermercados", "supermercados", "SUPERMARKET", 30],
    ["Electrónica", "electronica", "ELECTRONICS", 40],
    ["Emprendedores", "emprendedores", "ENTREPRENEUR", 50],
  ] as const;
  await db
    .insert(categories)
    .values(rubros.map(([name, slug, commissionCategory, sortOrder]) => ({ kind: "MERCHANT" as const, name, slug, commissionCategory, sortOrder })))
    .onConflictDoNothing({ target: [categories.kind, categories.slug] });
}

async function cityId(slug: string): Promise<string> {
  const [row] = await db.select({ id: cities.id }).from(cities).where(eq(cities.slug, slug));
  if (!row) throw new Error(`No existe la ciudad ${slug}`);
  return row.id;
}

async function rubroId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.kind, "MERCHANT"), eq(categories.slug, slug)));
  if (!row) throw new Error(`No existe el rubro ${slug}`);
  return row.id;
}

async function seedMerchant(m: DemoMerchant): Promise<"created" | "skipped"> {
  const [existing] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.slug, slugify(m.name)));
  if (existing) return "skipped";

  await ensureUser(m.owner);
  const owner = actor(m.owner);
  const merchant = await registerMerchant(
    db,
    {
      displayName: m.name,
      legalName: m.legalName,
      taxId: cuit(m.taxBase),
      categoryId: await rubroId(m.rubro),
      contactPhone: m.phone,
      contactEmail: devUserEmail(m.owner),
    },
    owner,
  );

  if (m.branch) {
    const b = m.branch;
    const branch = await createBranch(
      db,
      merchant.id,
      {
        name: b.name,
        cityId: await cityId(m.city),
        addressLine: b.address,
        addressNotes: b.notes ?? null,
        acceptsPickup: b.pickup,
        acceptsDelivery: b.delivery,
      },
      owner,
    );
    const ranges = b.hours.flatMap(([days, opens, closes]) =>
      days.map((weekday) => ({ weekday, opensAt: formatTime(parseTime(opens)!), closesAt: formatTime(parseTime(closes)!) })),
    );
    await replaceBranchHours(db, merchant.id, branch.id, ranges, owner);
    for (const [name, description, fee, min] of b.zones ?? []) {
      await createZone(db, merchant.id, branch.id, { name, description, feeMinor: pesos(fee), minOrderMinor: pesos(min) }, owner);
    }
  }

  for (const [i, section] of (m.sections ?? []).entries()) {
    const s = await createSection(db, merchant.id, { name: section.name, sortOrder: i * 10 }, owner);
    for (const [j, p] of section.products.entries()) {
      await createProduct(
        db,
        merchant.id,
        {
          name: p.name,
          description: p.description ?? null,
          sectionId: s.id,
          priceMinor: pesos(p.price),
          available: p.available ?? true,
          sortOrder: j,
          variants: (p.variants ?? []).map(([name, price]) => ({ name, priceMinor: pesos(price) })),
          modifierGroups: (p.groups ?? []).map((g) => ({
            name: g.name,
            minSelect: g.min,
            maxSelect: g.max,
            modifiers: g.options.map(([name, price, maxQuantity]) => ({ name, priceDeltaMinor: pesos(price), maxQuantity: maxQuantity ?? 1 })),
          })),
        },
        owner,
      );
    }
  }

  if (m.status !== "DRAFT") await submitMerchant(db, merchant.id, owner);
  if (m.status === "APPROVED") await approveMerchant(db, merchant.id, actor("ignacio"));
  return "created";
}

/** Hora fija dentro del horario de "La Esquina" (hoy 20:30 en Argentina), para poder crear pedidos a cualquier hora. */
function tonightAt2030(): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Cordoba" }).format(new Date());
  return new Date(`${ymd}T20:30:00-03:00`);
}

async function seedOrders() {
  const slug = "la-esquina-de-tostado";
  const now = tonightAt2030();
  const menu = await getPublicMerchantMenu(db, slug).catch(() => null);
  if (!menu) return 0;
  const branch = menu.merchant.branches[0]!;
  const products = menu.sections.flatMap((s) => s.products);
  let created = 0;

  for (const o of DEMO_ORDERS) {
    const items = o.items.map((it) => {
      const p = products.find((x) => x.name === it.product);
      if (!p) throw new Error(`Producto demo inexistente: ${it.product}`);
      const variant = it.variant ? p.variants.find((v) => v.name === it.variant) : undefined;
      const modifiers = (it.options ?? []).map(([name, quantity]) => {
        const m = p.modifierGroups.flatMap((g) => g.modifiers).find((x) => x.name === name);
        if (!m) throw new Error(`Opción demo inexistente: ${name}`);
        return { modifierId: m.id, quantity };
      });
      return { productId: p.id, variantId: variant?.id ?? null, modifiers, quantity: it.quantity, notes: it.notes ?? null };
    });
    const zone = o.delivery ? branch.zones.find((z) => z.name === o.delivery!.zone) : undefined;
    const result = await createOrder(
      db,
      {
        merchantSlug: slug,
        branchId: branch.id,
        fulfillmentType: o.delivery ? "DELIVERY" : "PICKUP",
        ...(o.delivery && { deliveryZoneId: zone?.id, deliveryAddress: { line: o.delivery.address, notes: o.delivery.notes ?? null } }),
        customer: { name: o.customer[0], phone: o.customer[1] },
        items,
      },
      o.key,
      { secret: config.orderTokenSecret, now },
    );
    if (result.replayed) continue;
    created++;
    for (const to of o.advance) {
      await transitionMerchantOrder(db, menu.merchant.id, result.order.id, to as never, null, devUserId("esquina"));
    }
  }
  return created;
}

try {
  await ensureBase();
  await ensureUser("ignacio", true);
  const summary: string[] = [];
  for (const m of DEMO_MERCHANTS) {
    const r = await seedMerchant(m);
    summary.push(`  ${r === "created" ? "✓" : "·"} ${m.name} (${m.status}) — dueño: ${m.owner}`);
  }
  const orders = await seedOrders();
  console.log(`Demo cargada:\n${summary.join("\n")}\n  Pedidos de ejemplo nuevos: ${orders}`);
  console.log(`\nEntrar al panel como dueño: npm run dev:token -w @pedilo/api -- --name <dueño>`);
  console.log(`Entrar al admin:           npm run dev:token -w @pedilo/api -- --name ignacio --admin`);
} finally {
  await close();
}
