import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { localWeekdayMinute } from "@pedilo/domain";

import { products } from "../src/db/schema";

import { bearer, createTestContext, type TestContext } from "./helpers";

/** Tipos de comida del inicio de la app (ADR 0027): categorías de producto destacadas y filtro. */

let ctx: TestContext;
let admin: string;
let owner: string;
let merchantId: string;
let otherMerchantId: string;
let ids: Record<string, string>;
let cityIdForTests: string;
let rubroForTests: string;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, opts: { token?: string; payload?: Body } = {}) =>
  ctx.app.inject({ method, url, headers: { ...(opts.token && bearer(opts.token)) }, ...(opts.payload !== undefined && { payload: opts.payload }) });

const category = async (payload: Body) => {
  const res = await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "PRODUCT", ...payload } });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};

const approvedMerchant = async (name: string, cityId: string, rubro: string, ranges?: Array<{ weekday: number; opensAt: string; closesAt: string }>) => {
  const id = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: name, legalName: "Ana Gómez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id as string;
  const branchId = (
    await req("POST", `/v1/merchants/${id}/branches`, {
      token: owner,
      payload: { name: "Centro", cityId, addressLine: "San Martín 123", phone: "3491 111222", acceptsPickup: true, acceptsDelivery: false },
    })
  ).json().id;
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" }));
  await req("PUT", `/v1/merchants/${id}/branches/${branchId}/hours`, { token: owner, payload: { ranges: ranges ?? allDay } });
  await req("POST", `/v1/merchants/${id}/submit`, { token: owner });
  await req("POST", `/v1/admin/merchants/${id}/approve`, { token: admin });
  return id;
};

const product = async (mId: string, name: string, categoryId: string | null, extra: Body = {}) => {
  const res = await req("POST", `/v1/merchants/${mId}/menu/products`, {
    token: owner,
    payload: { name, priceMinor: 500000, categoryId, variants: [], modifierGroups: [], ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
};

const cityMerchants = async (productCategoryId?: string) =>
  (
    (await req("GET", `/v1/public/cities/tostado/merchants${productCategoryId ? `?productCategoryId=${productCategoryId}` : ""}`)).json() as Array<{
      id: string;
    }>
  ).map((m) => m.id);

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  cityIdForTests = cityId;
  rubroForTests = rubro;

  const bebidas = await category({ name: "Bebidas", featuredOrder: 40 });
  ids = {
    bebidas,
    cervezas: await category({ name: "Cervezas", parentId: bebidas }),
    hamburguesas: await category({ name: "Hamburguesas", featuredOrder: 10 }),
    pizzas: await category({ name: "Pizzas", featuredOrder: 20 }),
    empanadas: await category({ name: "Empanadas" }),
  };
  merchantId = await approvedMerchant("Lo de Tito", cityId, rubro);
  otherMerchantId = await approvedMerchant("Pizzería Centro", cityId, rubro);
  await product(merchantId, "Doble cheddar", ids.hamburguesas!);
  await product(merchantId, "Quilmes 1 L", ids.cervezas!);
  await product(otherMerchantId, "Muzzarella", ids.pizzas!);
  await product(otherMerchantId, "Hamburguesa pausada", ids.hamburguesas!, { available: false });
});
afterAll(() => ctx.close());

describe("tipos de comida (ADR 0027)", () => {
  it("el inicio lista solo las destacadas, en su posición", async () => {
    const featured = (await req("GET", "/v1/categories?kind=PRODUCT&featured=true")).json() as Array<{ name: string; featuredOrder: number }>;
    expect(featured.map((c) => c.name)).toEqual(["Hamburguesas", "Pizzas", "Bebidas"]);
    const all = (await req("GET", "/v1/categories?kind=PRODUCT")).json() as Array<{ name: string }>;
    expect(all.map((c) => c.name)).toEqual(expect.arrayContaining(["Empanadas", "Cervezas"]));
  });

  it("el admin la saca o la mueve; un rubro no puede ser tipo de comida", async () => {
    expect((await req("PATCH", `/v1/admin/categories/${ids.pizzas}`, { token: admin, payload: { featuredOrder: 5 } })).statusCode).toBe(200);
    let featured = (await req("GET", "/v1/categories?kind=PRODUCT&featured=true")).json() as Array<{ name: string }>;
    expect(featured.map((c) => c.name)).toEqual(["Pizzas", "Hamburguesas", "Bebidas"]);
    await req("PATCH", `/v1/admin/categories/${ids.bebidas}`, { token: admin, payload: { featuredOrder: null } });
    featured = (await req("GET", "/v1/categories?kind=PRODUCT&featured=true")).json() as Array<{ name: string }>;
    expect(featured.map((c) => c.name)).toEqual(["Pizzas", "Hamburguesas"]);
    await req("PATCH", `/v1/admin/categories/${ids.bebidas}`, { token: admin, payload: { featuredOrder: 40 } });

    const rubro = await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Kioscos", featuredOrder: 1 } });
    expect(rubro.statusCode).toBe(400);
  });

  it("filtra comercios por lo que venden: incluye la rama y no cuenta productos pausados", async () => {
    expect((await cityMerchants()).sort()).toEqual([merchantId, otherMerchantId].sort());
    // La hamburguesa del otro comercio está pausada: no cuenta.
    expect(await cityMerchants(ids.hamburguesas)).toEqual([merchantId]);
    expect(await cityMerchants(ids.pizzas)).toEqual([otherMerchantId]);
    // «Bebidas» incluye «Cervezas».
    expect(await cityMerchants(ids.bebidas)).toEqual([merchantId]);
    expect(await cityMerchants(ids.empanadas)).toEqual([]);
  });

  it("platos para probar: con foto, sin pausados, repartidos entre comercios", async () => {
    // Sin fotos no hay platos.
    expect((await req("GET", "/v1/public/cities/tostado/dishes")).json()).toEqual([]);
    const extra = await product(merchantId, "Triple bacon", ids.hamburguesas!);
    const all = await ctx.db.select({ id: products.id, name: products.name }).from(products);
    await ctx.db
      .update(products)
      .set({ imagePath: "merchants/x/foto.webp" })
      .where(inArray(products.id, all.map((p) => p.id)));

    const dishes = (await req("GET", "/v1/public/cities/tostado/dishes")).json() as Array<{ name: string; merchant: { slug: string }; imageUrl: string }>;
    const names = dishes.map((d) => d.name);
    expect(names).not.toContain("Hamburguesa pausada");
    expect(names).toEqual(expect.arrayContaining(["Doble cheddar", "Quilmes 1 L", "Triple bacon", "Muzzarella"]));
    // Una vuelta por comercio: los dos primeros son de comercios distintos.
    expect(dishes[0]!.merchant.slug).not.toBe(dishes[1]!.merchant.slug);
    expect(dishes[0]!.imageUrl).toMatch(/foto\.webp$/);
    expect(((await req("GET", "/v1/public/cities/tostado/dishes?limit=2")).json() as unknown[]).length).toBe(2);
    expect((await req("GET", "/v1/public/cities/no-existe/dishes")).statusCode).toBe(404);
    expect(extra).toBeTruthy();
  });

  it("nivel de precio del comercio según la mediana de sus precios", async () => {
    // Todos los productos de prueba cuestan $5.000: nivel 1 ($). Con la mayoría arriba de $15.000, $$$.
    const list = (await req("GET", "/v1/public/cities/tostado/merchants")).json() as Array<{ id: string; priceLevel: number | null }>;
    expect(list.find((m) => m.id === merchantId)!.priceLevel).toBe(1);
    await product(otherMerchantId, "Pizza especial", ids.pizzas!, { priceMinor: 2_000_000 });
    await product(otherMerchantId, "Pizza gourmet", ids.pizzas!, { priceMinor: 2_500_000 });
    await product(otherMerchantId, "Pizza de autor", ids.pizzas!, { priceMinor: 3_000_000 });
    const again = (await req("GET", "/v1/public/cities/tostado/merchants")).json() as Array<{ id: string; priceLevel: number | null }>;
    expect(again.find((m) => m.id === otherMerchantId)!.priceLevel).toBe(3);
  });

  it("tiempo de preparación: lo carga el comercio aprobado y lo ve la app (ADR 0029)", async () => {
    const patch = (prepMinutes: unknown) => req("PATCH", `/v1/merchants/${merchantId}`, { token: owner, payload: { prepMinutes } });
    expect((await patch(4)).statusCode).toBe(400);
    expect((await patch(121)).statusCode).toBe(400);
    const ok = await patch(25);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().prepMinutes).toBe(25);
    const list = (await req("GET", "/v1/public/cities/tostado/merchants")).json() as Array<{ id: string; prepMinutes: number | null; isNew: boolean; opensNext: unknown }>;
    expect(list.find((m) => m.id === merchantId)).toMatchObject({ prepMinutes: 25, isNew: true, opensNext: null });
    expect((await req("GET", "/v1/public/merchants/lo-de-tito")).json().merchant.prepMinutes).toBe(25);
    expect((await patch(null)).json().prepMinutes).toBeNull();
  });

  it("cerrado: cuándo vuelve a abrir y si acepta programados (ADR 0029)", async () => {
    // Abre solo mañana de 10:00 a 11:00 (hora de la sucursal).
    const { weekday } = localWeekdayMinute(new Date(), "America/Argentina/Cordoba");
    const tomorrow = (weekday + 1) % 7;
    const id = await approvedMerchant("Heladería Siesta", cityIdForTests, rubroForTests, [{ weekday: tomorrow, opensAt: "10:00", closesAt: "11:00" }]);
    const list = (await req("GET", "/v1/public/cities/tostado/merchants")).json() as Array<{
      id: string;
      openNow: boolean;
      opensNext: { inDays: number; weekday: number; time: string } | null;
      schedulingEnabled: boolean;
    }>;
    expect(list.find((m) => m.id === id)).toMatchObject({
      openNow: false,
      opensNext: { inDays: 1, weekday: tomorrow, time: "10:00" },
      schedulingEnabled: false,
    });
  });
});
