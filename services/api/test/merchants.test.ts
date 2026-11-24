import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditRowsFor, bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: string;
let owner: string;
let ownerEmail: string;
let stranger: string;
let cityId: string;
let inactiveCityId: string;
let rubroId: string;
let productCategoryId: string;

const VALID_CUIT = "20-12345678-6";

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
  ownerEmail = "duenio@test.pedilo.local";
  owner = (await ctx.tokenFor({ email: ownerEmail })).token;
  stranger = (await ctx.tokenFor()).token;

  const post = (url: string, payload: Record<string, unknown>) =>
    ctx.app.inject({ method: "POST", url, headers: bearer(admin), payload });
  cityId = (await post("/v1/admin/cities", { name: "Tostado", province: "Santa Fe" })).json().id;
  inactiveCityId = (await post("/v1/admin/cities", { name: "Ceres", province: "Santa Fe", active: false })).json().id;
  rubroId = (
    await post("/v1/admin/categories", { kind: "MERCHANT", name: "Gastronomía", commissionCategory: "GASTRONOMY" })
  ).json().id;
  productCategoryId = (await post("/v1/admin/categories", { kind: "PRODUCT", name: "Bebidas" })).json().id;
});
afterAll(() => ctx.close());

const req = (method: "GET" | "POST" | "PATCH" | "PUT", url: string, token: string, payload?: Record<string, unknown>) =>
  ctx.app.inject({ method, url, headers: bearer(token), ...(payload !== undefined && { payload }) });

const register = (token: string, over: Record<string, unknown> = {}) =>
  req("POST", "/v1/merchants", token, {
    displayName: "La Esquina",
    legalName: "La Esquina SRL",
    taxId: VALID_CUIT,
    categoryId: rubroId,
    contactPhone: "3491 123456",
    ...over,
  });

const branchBody = (over: Record<string, unknown> = {}) => ({
  name: "Centro",
  cityId,
  addressLine: "San Martín 123",
  ...over,
});

const weekdays = (from: number, to: number, opensAt = "09:00", closesAt = "13:00") =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ weekday: from + i, opensAt, closesAt }));

describe("registro de comercio", () => {
  it("crea el comercio en borrador, con quien lo registra como dueño", async () => {
    const res = await register(owner);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      displayName: "La Esquina",
      slug: "la-esquina",
      taxId: "20123456786",
      status: "DRAFT",
      branches: [],
      onboarding: { ready: false, problems: [{ issue: "NO_ACTIVE_BRANCH" }] },
    });

    const mine = (await req("GET", "/v1/me/merchants", owner)).json();
    expect(mine).toEqual([expect.objectContaining({ id: body.id, role: "OWNER" })]);
  });

  it("slug repetido se desambigua con sufijo", async () => {
    const res = await register(stranger, { taxId: "30-71234567-1" });
    expect(res.json().slug).toBe("la-esquina-2");
  });

  it("valida CUIT y que el rubro sea una categoría de comercio activa", async () => {
    const badCuit = await register(owner, { taxId: "20-12345678-5" });
    expect(badCuit.statusCode).toBe(400);
    expect(badCuit.json().error.code).toBe("VALIDATION_ERROR");

    const productAsRubro = await register(owner, { categoryId: productCategoryId });
    expect(productAsRubro.statusCode).toBe(400);
    expect(productAsRubro.json().error.details).toMatchObject({ field: "categoryId" });
  });

  it("sin sesión no se puede registrar", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/v1/merchants", payload: {} });
    expect(res.statusCode).toBe(401);
  });
});

describe("onboarding completo: borrador → revisión → rechazo → reenvío → aprobación", () => {
  let merchantId: string;
  let branchId: string;

  beforeAll(async () => {
    merchantId = (await register(owner, { displayName: "Pizzería Don Pepe" })).json().id;
  });

  it("un usuario ajeno ve 404 (no se revela que existe) y no puede editar", async () => {
    expect((await req("GET", `/v1/merchants/${merchantId}`, stranger)).statusCode).toBe(404);
    expect((await req("PATCH", `/v1/merchants/${merchantId}`, stranger, { displayName: "X Y" })).statusCode).toBe(404);
    expect((await req("POST", `/v1/merchants/${merchantId}/branches`, stranger, branchBody())).statusCode).toBe(404);
  });

  it("no se puede enviar a revisión sin sucursal", async () => {
    const res = await req("POST", `/v1/merchants/${merchantId}/submit`, owner);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toMatchObject({
      reason: "ONBOARDING_INCOMPLETE",
      problems: [{ issue: "NO_ACTIVE_BRANCH" }],
    });
  });

  it("la sucursal no puede estar en una ciudad inactiva", async () => {
    const res = await req("POST", `/v1/merchants/${merchantId}/branches`, owner, branchBody({ cityId: inactiveCityId }));
    expect(res.statusCode).toBe(400);
  });

  it("crea sucursal solo con envío: copia la zona horaria de la ciudad", async () => {
    const res = await req(
      "POST",
      `/v1/merchants/${merchantId}/branches`,
      owner,
      branchBody({ acceptsPickup: false, acceptsDelivery: true }),
    );
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ timezone: "America/Argentina/Cordoba", hours: [], zones: [] });
    branchId = res.json().id;
  });

  it("horarios superpuestos se rechazan con detalle", async () => {
    const res = await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, owner, {
      ranges: [
        { weekday: 1, opensAt: "09:00", closesAt: "13:00" },
        { weekday: 1, opensAt: "12:00", closesAt: "15:00" },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.problems).toEqual([{ error: "OVERLAP", index: 1 }]);
  });

  it("guarda horario cortado y nocturno", async () => {
    const res = await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, owner, {
      ranges: [
        ...weekdays(2, 6, "11:30", "14:30"),
        ...weekdays(2, 6, "20:00", "01:00"),
        { weekday: 0, opensAt: "20:00", closesAt: "24:00" },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hours).toHaveLength(11);
    expect(res.json().hours).toContainEqual({ weekday: 5, opensAt: "20:00", closesAt: "01:00" });
  });

  it("con envío pero sin zonas sigue sin poder enviarse", async () => {
    const res = await req("POST", `/v1/merchants/${merchantId}/submit`, owner);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.problems).toEqual([{ issue: "BRANCH_WITHOUT_FULFILLMENT", branchId }]);
  });

  it("agrega una zona y lo envía a revisión", async () => {
    const zone = await req("POST", `/v1/merchants/${merchantId}/branches/${branchId}/zones`, owner, {
      name: "Centro",
      description: "Bv. Roca a Belgrano",
      feeMinor: 150000,
      minOrderMinor: 500000,
    });
    expect(zone.statusCode).toBe(201);
    expect(zone.json()).toMatchObject({ feeMinor: 150000, minOrderMinor: 500000, active: true });

    const res = await req("POST", `/v1/merchants/${merchantId}/submit`, owner);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "PENDING_REVIEW", onboarding: { ready: true, problems: [] } });
    expect(res.json().submittedAt).toBeTruthy();
  });

  it("en revisión no se puede editar nada", async () => {
    const patch = await req("PATCH", `/v1/merchants/${merchantId}`, owner, { displayName: "Otro nombre" });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.details.reason).toBe("IN_REVIEW");
    const branch = await req("POST", `/v1/merchants/${merchantId}/branches`, owner, branchBody({ name: "Norte" }));
    expect(branch.statusCode).toBe(409);
  });

  it("el admin lo ve en la cola con dueño y cantidad de sucursales", async () => {
    const res = await req("GET", "/v1/admin/merchants?status=PENDING_REVIEW", admin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toContainEqual(
      expect.objectContaining({ id: merchantId, branchCount: 1, owner: expect.objectContaining({ email: ownerEmail }) }),
    );
    const detail = await req("GET", `/v1/admin/merchants/${merchantId}`, admin);
    expect(detail.json().branches[0].zones).toHaveLength(1);
  });

  it("un usuario sin rol admin no accede a la cola", async () => {
    expect((await req("GET", "/v1/admin/merchants", owner)).statusCode).toBe(403);
    expect((await req("POST", `/v1/admin/merchants/${merchantId}/approve`, owner)).statusCode).toBe(403);
  });

  it("rechazar exige motivo; el comercio lo ve y puede corregir", async () => {
    expect((await req("POST", `/v1/admin/merchants/${merchantId}/reject`, admin, { reason: "" })).statusCode).toBe(400);

    const rejected = await req("POST", `/v1/admin/merchants/${merchantId}/reject`, admin, {
      reason: "La razón social no coincide con el CUIT",
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({ status: "REJECTED", rejectionReason: "La razón social no coincide con el CUIT" });

    const mine = (await req("GET", `/v1/merchants/${merchantId}`, owner)).json();
    expect(mine.rejectionReason).toBe("La razón social no coincide con el CUIT");

    const fix = await req("PATCH", `/v1/merchants/${merchantId}`, owner, { legalName: "José Pérez" });
    expect(fix.statusCode).toBe(200);
    expect(fix.json().legalName).toBe("José Pérez");
  });

  it("reenvío limpia el motivo y la aprobación queda auditada", async () => {
    const resubmit = await req("POST", `/v1/merchants/${merchantId}/submit`, owner);
    expect(resubmit.json()).toMatchObject({ status: "PENDING_REVIEW", rejectionReason: null });

    const approved = await req("POST", `/v1/admin/merchants/${merchantId}/approve`, admin);
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "APPROVED", reviewedAt: expect.any(String) });

    const actions = (await auditRowsFor(ctx.db, merchantId)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(["merchant.register", "merchant.submit", "merchant.reject", "merchant.update", "merchant.approve"]),
    );
  });

  it("no se aprueba dos veces", async () => {
    const res = await req("POST", `/v1/admin/merchants/${merchantId}/approve`, admin);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.reason).toBe("INVALID_STATUS");
  });

  it("aprobado: datos fiscales bloqueados, contacto y operación editables", async () => {
    const locked = await req("PATCH", `/v1/merchants/${merchantId}`, owner, { legalName: "Otra SRL" });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.details).toMatchObject({ reason: "FIELDS_LOCKED", fields: ["legalName"] });

    const contact = await req("PATCH", `/v1/merchants/${merchantId}`, owner, { contactPhone: "3491 999999" });
    expect(contact.statusCode).toBe(200);

    const hours = await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, owner, {
      ranges: weekdays(0, 6, "10:00", "22:00"),
    });
    expect(hours.statusCode).toBe(200);
  });

  it("zona de otra sucursal o inexistente → 404", async () => {
    const res = await req(
      "PATCH",
      `/v1/merchants/${merchantId}/branches/${branchId}/zones/${crypto.randomUUID()}`,
      owner,
      { active: false },
    );
    expect(res.statusCode).toBe(404);
  });
});
