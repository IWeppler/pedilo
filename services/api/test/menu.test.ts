import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { merchants } from "../src/db/schema";
import { auditRowsFor, bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: string;
let owner: string;
let stranger: string;
let merchantId: string;
let merchantSlug: string;
let productCategoryId: string;
let merchantCategoryId: string;
let cityId: string;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PATCH" | "PUT", url: string, token?: string, payload?: Body) =>
  ctx.app.inject({
    method,
    url,
    ...(token && { headers: bearer(token) }),
    ...(payload !== undefined && { payload }),
  });

const menuUrl = () => `/v1/merchants/${merchantId}/menu`;

const pizzaBody = (over: Body = {}): Body => ({
  name: "Muzzarella",
  description: "Salsa de tomate y muzzarella",
  priceMinor: 900000,
  variants: [
    { name: "Chica", priceMinor: 600000 },
    { name: "Grande", priceMinor: 900000 },
  ],
  modifierGroups: [
    {
      name: "Masa",
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { name: "Común", priceDeltaMinor: 0 },
        { name: "Integral", priceDeltaMinor: 50000 },
      ],
    },
    {
      name: "Extras",
      minSelect: 0,
      maxSelect: 3,
      modifiers: [{ name: "Extra queso", priceDeltaMinor: 80000, maxQuantity: 2 }],
    },
  ],
  ...over,
});

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  stranger = (await ctx.tokenFor()).token;

  cityId = (await req("POST", "/v1/admin/cities", admin, { name: "Tostado", province: "Santa Fe" })).json().id;
  merchantCategoryId = (
    await req("POST", "/v1/admin/categories", admin, { kind: "MERCHANT", name: "Gastronomía", commissionCategory: "GASTRONOMY" })
  ).json().id;
  productCategoryId = (await req("POST", "/v1/admin/categories", admin, { kind: "PRODUCT", name: "Pizzas" })).json().id;

  const merchant = (
    await req("POST", "/v1/merchants", owner, {
      displayName: "Pizzería Don Pepe",
      legalName: "José Pérez",
      taxId: "20-12345678-6",
      categoryId: merchantCategoryId,
      contactPhone: "3491 123456",
    })
  ).json();
  merchantId = merchant.id;
  merchantSlug = merchant.slug;
});
afterAll(() => ctx.close());

describe("secciones y productos (comercio en borrador)", () => {
  let sectionId: string;
  let pizzaId: string;

  it("crea secciones; el menú arranca vacío", async () => {
    const res = await req("POST", `${menuUrl()}/sections`, owner, { name: "Pizzas", sortOrder: 1 });
    expect(res.statusCode).toBe(201);
    sectionId = res.json().id;
    const menu = (await req("GET", menuUrl(), owner)).json();
    expect(menu).toEqual({ sections: [expect.objectContaining({ name: "Pizzas", active: true })], products: [] });
  });

  it("crea un producto con variantes y modificadores; el precio desde es la variante más barata", async () => {
    const res = await req("POST", `${menuUrl()}/products`, owner, pizzaBody({ sectionId, categoryId: productCategoryId }));
    expect(res.statusCode).toBe(201);
    const p = res.json();
    pizzaId = p.id;
    expect(p).toMatchObject({ name: "Muzzarella", sectionId, fromPriceMinor: 600000, available: true, active: true });
    expect(p.variants.map((v: { name: string }) => v.name)).toEqual(["Chica", "Grande"]);
    expect(p.modifierGroups[0]).toMatchObject({ name: "Masa", minSelect: 1, maxSelect: 1 });
    expect(p.modifierGroups[1].modifiers[0]).toMatchObject({ name: "Extra queso", maxQuantity: 2, available: true });
  });

  it("producto simple sin sección", async () => {
    const res = await req("POST", `${menuUrl()}/products`, owner, {
      name: "Coca-Cola 1,5 L",
      priceMinor: 350000,
      variants: [],
      modifierGroups: [],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sectionId: null, fromPriceMinor: 350000 });
  });

  it("las reglas de dominio se validan en el servidor con detalle", async () => {
    const res = await req(
      "POST",
      `${menuUrl()}/products`,
      owner,
      pizzaBody({
        variants: [
          { name: "Chica", priceMinor: 1 },
          { name: "chica ", priceMinor: 2 },
        ],
        modifierGroups: [{ name: "Masa", minSelect: 2, maxSelect: 1, modifiers: [{ name: "Común", priceDeltaMinor: 0 }] }],
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.problems).toEqual(
      expect.arrayContaining([
        { issue: "DUPLICATE_VARIANT", path: "variants.1" },
        { issue: "INVALID_SELECT_RANGE", path: "modifierGroups.0" },
      ]),
    );
  });

  it("reemplazar conserva los ids enviados, crea los nuevos y borra los que faltan", async () => {
    const current = (await req("GET", menuUrl(), owner)).json().products.find((p: { id: string }) => p.id === pizzaId);
    const chica = current.variants[0];
    const masa = current.modifierGroups[0];
    const res = await req(
      "PUT",
      `${menuUrl()}/products/${pizzaId}`,
      owner,
      pizzaBody({
        sectionId,
        variants: [
          { id: chica.id, name: "Chica", priceMinor: 650000 },
          { name: "Mediana", priceMinor: 800000 },
        ],
        modifierGroups: [
          {
            id: masa.id,
            name: "Masa",
            minSelect: 1,
            maxSelect: 1,
            modifiers: [{ id: masa.modifiers[0].id, name: "Común", priceDeltaMinor: 0 }],
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.variants).toEqual([
      expect.objectContaining({ id: chica.id, name: "Chica", priceMinor: 650000 }),
      expect.objectContaining({ name: "Mediana" }),
    ]);
    expect(p.modifierGroups).toHaveLength(1);
    expect(p.modifierGroups[0]).toMatchObject({ id: masa.id, modifiers: [{ id: masa.modifiers[0].id }] });
  });

  it("no se pueden usar ids de otro producto", async () => {
    const other = (
      await req("POST", `${menuUrl()}/products`, owner, {
        name: "Fugazzeta",
        priceMinor: 1,
        variants: [{ name: "Única", priceMinor: 1 }],
        modifierGroups: [],
      })
    ).json();
    const res = await req("PUT", `${menuUrl()}/products/${pizzaId}`, owner, {
      ...pizzaBody(),
      variants: [{ id: other.variants[0].id, name: "Robada", priceMinor: 1 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("un producto nuevo no puede traer ids de hijos", async () => {
    const res = await req("POST", `${menuUrl()}/products`, owner, {
      ...pizzaBody(),
      variants: [{ id: crypto.randomUUID(), name: "X", priceMinor: 1 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("valida sección del comercio y categoría de tipo producto", async () => {
    const foreignSection = await req("POST", `${menuUrl()}/products`, owner, pizzaBody({ sectionId: crypto.randomUUID() }));
    expect(foreignSection.statusCode).toBe(400);
    const wrongKind = await req("POST", `${menuUrl()}/products`, owner, pizzaBody({ categoryId: merchantCategoryId }));
    expect(wrongKind.statusCode).toBe(400);
    expect(wrongKind.json().error.details).toMatchObject({ field: "categoryId" });
  });

  it("pausar y reanudar queda auditado", async () => {
    const paused = await req("PATCH", `${menuUrl()}/products/${pizzaId}/availability`, owner, { available: false });
    expect(paused.json().available).toBe(false);
    await req("PATCH", `${menuUrl()}/products/${pizzaId}/availability`, owner, { available: true });
    const actions = (await auditRowsFor(ctx.db, pizzaId)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["menu.product.create", "menu.product.update", "menu.product.pause", "menu.product.resume"]));
  });

  it("un usuario ajeno no ve ni edita el menú (404)", async () => {
    expect((await req("GET", menuUrl(), stranger)).statusCode).toBe(404);
    expect((await req("POST", `${menuUrl()}/sections`, stranger, { name: "Hack" })).statusCode).toBe(404);
    expect((await req("PATCH", `${menuUrl()}/products/${pizzaId}/availability`, stranger, { available: false })).statusCode).toBe(404);
  });
});

describe("menú público", () => {
  it("un comercio no aprobado no se publica", async () => {
    expect((await req("GET", `/v1/public/merchants/${merchantSlug}`)).statusCode).toBe(404);
  });

  it("aprobado: muestra secciones activas, «Otros» al final, oculta archivados y secciones inactivas", async () => {
    // Completa el alta y aprueba.
    const branch = (
      await req("POST", `/v1/merchants/${merchantId}/branches`, owner, { name: "Centro", cityId, addressLine: "San Martín 123" })
    ).json();
    await req("PUT", `/v1/merchants/${merchantId}/branches/${branch.id}/hours`, owner, {
      ranges: [{ weekday: 5, opensAt: "20:00", closesAt: "01:00" }],
    });
    await req("POST", `/v1/merchants/${merchantId}/submit`, owner);
    expect((await req("POST", `/v1/admin/merchants/${merchantId}/approve`, admin)).statusCode).toBe(200);

    // Una sección oculta con un producto, y un producto archivado.
    const hidden = (await req("POST", `${menuUrl()}/sections`, owner, { name: "Ocultos", active: false })).json();
    await req("POST", `${menuUrl()}/products`, owner, { name: "Secreto", priceMinor: 1, sectionId: hidden.id, variants: [], modifierGroups: [] });
    await req("POST", `${menuUrl()}/products`, owner, { name: "Archivado", priceMinor: 1, active: false, variants: [], modifierGroups: [] });

    const res = await req("GET", `/v1/public/merchants/${merchantSlug}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.merchant).toMatchObject({ displayName: "Pizzería Don Pepe", branches: [expect.objectContaining({ name: "Centro" })] });
    expect(body.merchant).not.toHaveProperty("taxId");
    expect(body.sections.map((s: { name: string }) => s.name)).toEqual(["Pizzas", "Otros"]);
    const names = body.sections.flatMap((s: { products: Array<{ name: string }> }) => s.products.map((p) => p.name));
    expect(names).toEqual(expect.arrayContaining(["Muzzarella", "Coca-Cola 1,5 L"]));
    expect(names).not.toContain("Secreto");
    expect(names).not.toContain("Archivado");
    expect(body.sections[0].products[0]).not.toHaveProperty("active");
  });

  it("el catálogo se puede editar con el comercio aprobado, no suspendido", async () => {
    expect((await req("POST", `${menuUrl()}/sections`, owner, { name: "Bebidas" })).statusCode).toBe(201);
    await ctx.db.update(merchants).set({ status: "SUSPENDED" }).where(eq(merchants.id, merchantId));
    const res = await req("POST", `${menuUrl()}/sections`, owner, { name: "Postres" });
    expect(res.statusCode).toBe(409);
    expect((await req("GET", `/v1/public/merchants/${merchantSlug}`)).statusCode).toBe(404);
  });
});
