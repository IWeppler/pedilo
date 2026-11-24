import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: string;

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
});
afterAll(() => ctx.close());

const create = (body: Record<string, unknown>) =>
  ctx.app.inject({ method: "POST", url: "/v1/admin/categories", headers: bearer(admin), payload: body });
const patch = (id: string, body: Record<string, unknown>) =>
  ctx.app.inject({ method: "PATCH", url: `/v1/admin/categories/${id}`, headers: bearer(admin), payload: body });
const publicList = async (kind?: string) =>
  (await ctx.app.inject({ method: "GET", url: `/v1/categories${kind ? `?kind=${kind}` : ""}` })).json() as Array<{
    id: string;
    slug: string;
    kind: string;
    name: string;
    sortOrder: number;
  }>;

describe("categorías", () => {
  it("crea un rubro con su categoría de comisión", async () => {
    const res = await create({ kind: "MERCHANT", name: "Gastronomía", commissionCategory: "GASTRONOMY" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      kind: "MERCHANT",
      slug: "gastronomia",
      commissionCategory: "GASTRONOMY",
      parentId: null,
      sortOrder: 0,
    });
  });

  it("GET /v1/admin/categories/:id devuelve el detalle o 404", async () => {
    const created = (await create({ kind: "PRODUCT", name: "Bebidas sin alcohol" })).json();
    const ok = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/categories/${created.id}`,
      headers: bearer(admin),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: created.id, slug: "bebidas-sin-alcohol" });

    const missing = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/categories/${crypto.randomUUID()}`,
      headers: bearer(admin),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("una categoría de producto no puede tener categoría de comisión", async () => {
    const res = await create({ kind: "PRODUCT", name: "Bebidas", commissionCategory: "KIOSK" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
  });

  it("categoría de comisión inexistente → 400 de validación", async () => {
    const res = await create({ kind: "MERCHANT", name: "Ferretería", commissionCategory: "HARDWARE" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("el mismo slug puede existir en tipos distintos, pero no repetido en el mismo tipo", async () => {
    expect((await create({ kind: "PRODUCT", name: "Almacén" })).statusCode).toBe(201);
    expect((await create({ kind: "MERCHANT", name: "Almacén" })).statusCode).toBe(201);
    expect((await create({ kind: "PRODUCT", name: "Almacén" })).statusCode).toBe(409);
  });

  it("el padre debe existir y ser del mismo tipo", async () => {
    const rubro = (await create({ kind: "MERCHANT", name: "Farmacia" })).json();
    const wrongKind = await create({ kind: "PRODUCT", name: "Analgésicos", parentId: rubro.id });
    expect(wrongKind.statusCode).toBe(400);

    const missing = await create({ kind: "PRODUCT", name: "Huérfana", parentId: crypto.randomUUID() });
    expect(missing.statusCode).toBe(400);
  });

  it("no se puede crear un ciclo al mover categorías", async () => {
    const a = (await create({ kind: "PRODUCT", name: "Lácteos" })).json();
    const b = (await create({ kind: "PRODUCT", name: "Quesos", parentId: a.id })).json();
    const c = (await create({ kind: "PRODUCT", name: "Quesos duros", parentId: b.id })).json();

    expect((await patch(a.id, { parentId: c.id })).statusCode).toBe(400);
    expect((await patch(a.id, { parentId: a.id })).statusCode).toBe(400);
    // Mover a la raíz sí está permitido.
    const toRoot = await patch(c.id, { parentId: null });
    expect(toRoot.statusCode).toBe(200);
    expect(toRoot.json().parentId).toBeNull();
  });

  it("desactivar un padre oculta toda su rama del listado público", async () => {
    const parent = (await create({ kind: "PRODUCT", name: "Panadería" })).json();
    const child = (await create({ kind: "PRODUCT", name: "Facturas", parentId: parent.id })).json();
    const grandchild = (await create({ kind: "PRODUCT", name: "Medialunas", parentId: child.id })).json();

    let visible = (await publicList("PRODUCT")).map((c) => c.id);
    expect(visible).toEqual(expect.arrayContaining([parent.id, child.id, grandchild.id]));

    await patch(parent.id, { active: false });
    visible = (await publicList("PRODUCT")).map((c) => c.id);
    expect(visible).not.toContain(parent.id);
    expect(visible).not.toContain(child.id);
    expect(visible).not.toContain(grandchild.id);

    const adminList = (
      await ctx.app.inject({ method: "GET", url: "/v1/admin/categories?kind=PRODUCT", headers: bearer(admin) })
    ).json();
    expect(adminList.map((c: { id: string }) => c.id)).toContain(grandchild.id);
  });

  it("el filtro por tipo funciona y el tipo no se puede cambiar con PATCH", async () => {
    const merchantOnly = await publicList("MERCHANT");
    expect(merchantOnly.every((c) => c.kind === "MERCHANT")).toBe(true);

    const cat = (await create({ kind: "MERCHANT", name: "Librería" })).json();
    const res = await patch(cat.id, { kind: "PRODUCT", name: "Librería y regalería" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: "MERCHANT", name: "Librería y regalería" });
  });

  it("orden por sortOrder y luego por nombre", async () => {
    // "Bazar" va primero alfabéticamente, pero con sortOrder 1 queda después de todos los de sortOrder 0.
    await create({ kind: "MERCHANT", name: "Bazar", sortOrder: 1 });
    const list = await publicList("MERCHANT");
    expect(list.at(-1)?.slug).toBe("bazar");

    const zeroOrder = list.filter((c) => c.sortOrder === 0).map((c) => c.name);
    expect(zeroOrder.length).toBeGreaterThan(1);
    expect(zeroOrder).toEqual([...zeroOrder].sort());
  });
});
