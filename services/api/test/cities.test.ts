import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditRowsFor, bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: string;

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
});
afterAll(() => ctx.close());

const createCity = (body: Record<string, unknown>, token = admin) =>
  ctx.app.inject({ method: "POST", url: "/v1/admin/cities", headers: bearer(token), payload: body });

describe("ciudades", () => {
  it("un admin crea una ciudad; el slug se genera sin tildes", async () => {
    const res = await createCity({ name: "Gálvez", province: "Santa Fe" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: "Gálvez",
      slug: "galvez",
      province: "Santa Fe",
      country: "AR",
      timezone: "America/Argentina/Cordoba",
      active: true,
    });
  });

  it("la creación queda auditada con actor y request", async () => {
    const res = await createCity({ name: "Ceres", province: "Santa Fe" });
    const rows = await auditRowsFor(ctx.db, res.json().id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "city.create", entityType: "city" });
    expect(rows[0]?.actorUserId).toBeTruthy();
    expect(rows[0]?.requestId).toBe(res.headers["x-request-id"]);
  });

  it("slug repetido → 409 CONFLICT", async () => {
    await createCity({ name: "Tostado", province: "Santa Fe" });
    const res = await createCity({ name: "Tostado (otra)", province: "Santa Fe", slug: "tostado" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("validación: nombre corto, slug inválido y zona horaria inexistente → 400 con detalle", async () => {
    const res = await createCity({ name: "X", province: "Santa Fe", slug: "Con Espacios", timezone: "Marte/Olympus" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    const paths = body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["/name", "/slug", "/timezone"]));
  });

  it("un usuario sin rol no puede administrar ciudades", async () => {
    const { token } = await ctx.tokenFor();
    expect((await createCity({ name: "Rafaela", province: "Santa Fe" }, token)).statusCode).toBe(403);
    const anon = await ctx.app.inject({ method: "POST", url: "/v1/admin/cities", payload: { name: "Rafaela" } });
    expect(anon.statusCode).toBe(401);
  });

  it("desactivar una ciudad la oculta del listado público pero no del admin", async () => {
    const created = (await createCity({ name: "San Cristóbal", province: "Santa Fe" })).json();
    const patch = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/admin/cities/${created.id}`,
      headers: bearer(admin),
      payload: { active: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().active).toBe(false);

    const publicList = (await ctx.app.inject({ method: "GET", url: "/v1/cities" })).json();
    expect(publicList.map((c: { slug: string }) => c.slug)).not.toContain("san-cristobal");

    const adminList = (await ctx.app.inject({ method: "GET", url: "/v1/admin/cities", headers: bearer(admin) })).json();
    expect(adminList.map((c: { slug: string }) => c.slug)).toContain("san-cristobal");

    const audit = await auditRowsFor(ctx.db, created.id);
    const update = audit.find((r) => r.action === "city.update");
    expect(update?.before).toMatchObject({ active: true });
    expect(update?.after).toMatchObject({ active: false });
  });

  it("PATCH vacío → 400; id inexistente → 404", async () => {
    const empty = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/admin/cities/${crypto.randomUUID()}`,
      headers: bearer(admin),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const missing = await ctx.app.inject({
      method: "PATCH",
      url: `/v1/admin/cities/${crypto.randomUUID()}`,
      headers: bearer(admin),
      payload: { name: "Nueva" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /v1/admin/cities/:id devuelve el detalle, 404 si no existe, 403 sin rol", async () => {
    const created = (await createCity({ name: "Rafaela", province: "Santa Fe" })).json();
    const ok = await ctx.app.inject({ method: "GET", url: `/v1/admin/cities/${created.id}`, headers: bearer(admin) });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: created.id, slug: "rafaela" });

    const missing = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/cities/${crypto.randomUUID()}`,
      headers: bearer(admin),
    });
    expect(missing.statusCode).toBe(404);

    const { token } = await ctx.tokenFor();
    const noRole = await ctx.app.inject({ method: "GET", url: `/v1/admin/cities/${created.id}`, headers: bearer(token) });
    expect(noRole.statusCode).toBe(403);
  });

  it("el listado público está ordenado por nombre", async () => {
    const names = (await ctx.app.inject({ method: "GET", url: "/v1/cities" })).json().map((c: { name: string }) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
