import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearer, createTestContext, type TestContext } from "./helpers";

/** Cuentas de clientes (ADR 0026): perfil, «mis pedidos» y pedir solo con cuenta registrada. */

let ctx: TestContext;
let branchId: string;
let productId: string;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

let seq = 0;
const placeOrder = (token?: string) =>
  req("POST", "/v1/public/orders", {
    ...(token && { token }),
    headers: { "idempotency-key": `customer-${++seq}-${Date.now()}` },
    payload: {
      merchantSlug: "kiosco-cuentas",
      branchId,
      fulfillmentType: "PICKUP",
      items: [{ productId, modifiers: [], quantity: 1 }],
    },
  });

beforeAll(async () => {
  ctx = await createTestContext();
  const admin = await ctx.adminToken();
  const owner = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Kioscos" } })).json().id;
  const merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Kiosco Cuentas", legalName: "Ana Gómez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id;
  branchId = (
    await req("POST", `/v1/merchants/${merchantId}/branches`, {
      token: owner,
      payload: { name: "Centro", cityId, addressLine: "San Martín 123", phone: "3491 111222", acceptsPickup: true, acceptsDelivery: false },
    })
  ).json().id;
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" }));
  await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: allDay } });
  await req("POST", `/v1/merchants/${merchantId}/submit`, { token: owner });
  await req("POST", `/v1/admin/merchants/${merchantId}/approve`, { token: admin });
  productId = (
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, {
      token: owner,
      payload: { name: "Alfajor", priceMinor: 150000, variants: [], modifierGroups: [] },
    })
  ).json().id;
});
afterAll(() => ctx.close());

describe("cuentas de clientes (ADR 0026)", () => {
  it("sin sesión no hay perfil; con sesión, 404 hasta completar el registro", async () => {
    expect((await req("GET", "/v1/customer/me")).statusCode).toBe(401);
    const { token } = await ctx.tokenFor();
    expect((await req("GET", "/v1/customer/me", { token })).statusCode).toBe(404);
    expect((await req("PUT", "/v1/customer/me", { token, payload: { displayName: "A", phone: "123" } })).statusCode).toBe(400);
    const saved = await req("PUT", "/v1/customer/me", { token, payload: { displayName: "Ana Gómez", phone: "3491 555-111" } });
    expect(saved.statusCode).toBe(200);
    expect((await req("GET", "/v1/customer/me", { token })).json()).toMatchObject({ displayName: "Ana Gómez", phone: "3491 555-111" });
    await req("PUT", "/v1/customer/me", { token, payload: { displayName: "Ana G.", phone: "3491 555-222" } });
    expect((await req("GET", "/v1/customer/me", { token })).json()).toMatchObject({ displayName: "Ana G.", phone: "3491 555-222" });
  });

  it("sin cuenta o sin perfil completo no se puede pedir", async () => {
    expect((await placeOrder()).statusCode).toBe(401);
    const { token } = await ctx.tokenFor();
    const res = await placeOrder(token);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.reason).toBe("PROFILE_REQUIRED");
    await req("PUT", "/v1/customer/me", { token, payload: { displayName: "Juan Pérez", phone: "3491 555-333" } });
    expect((await placeOrder(token)).statusCode).toBe(201);
  });

  it("los pedidos quedan en «mis pedidos» de la cuenta, con token de seguimiento", async () => {
    const token = await ctx.customerToken();
    const other = await ctx.customerToken();
    const first = await placeOrder(token);
    expect(first.statusCode).toBe(201);
    const second = await placeOrder(token);
    await placeOrder(other);

    const mine = await req("GET", "/v1/customer/orders", { token });
    expect(mine.statusCode).toBe(200);
    const list = mine.json() as Array<{ id: string; trackingToken: string; merchantName: string; totalMinor: number }>;
    expect(list.map((o) => o.id)).toEqual([second.json().order.id, first.json().order.id]);
    expect(list[0]).toMatchObject({
      merchantName: "Kiosco Cuentas",
      merchantSlug: "kiosco-cuentas",
      itemsSummary: "Alfajor",
      totalMinor: 150000,
      trackingToken: second.json().trackingToken,
    });
    // El token abre el seguimiento como siempre.
    const tracked = await req("GET", `/v1/public/orders/${list[0]!.id}`, { headers: { "x-order-token": list[0]!.trackingToken } });
    expect(tracked.statusCode).toBe(200);
    expect((await req("GET", "/v1/customer/orders")).statusCode).toBe(401);
  });

  it("reintentar con la misma clave devuelve el pedido solo a quien lo hizo", async () => {
    const token = await ctx.customerToken();
    const key = `replay-${Date.now()}`;
    const body = {
      merchantSlug: "kiosco-cuentas",
      branchId,
      fulfillmentType: "PICKUP",
      items: [{ productId, modifiers: [], quantity: 1 }],
    };
    const send = (t: string) => req("POST", "/v1/public/orders", { token: t, headers: { "idempotency-key": key }, payload: body });
    const created = await send(token);
    expect(created.statusCode).toBe(201);
    const again = await send(token);
    expect(again.json()).toMatchObject({ replayed: true, order: { id: created.json().order.id } });
    const stranger = await send(await ctx.customerToken());
    expect(stranger.statusCode).toBe(409);
    expect(stranger.json().error.details.reason).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(JSON.stringify(stranger.json())).not.toContain(created.json().trackingToken);
  });

  it("el pedido usa nombre y teléfono del perfil, aunque el request mande otros", async () => {
    const token = await ctx.customerToken({ displayName: "Lucía Paz", phone: "3491 444-555" });
    const res = await req("POST", "/v1/public/orders", {
      token,
      headers: { "idempotency-key": `profile-${Date.now()}` },
      payload: {
        merchantSlug: "kiosco-cuentas",
        branchId,
        fulfillmentType: "PICKUP",
        customer: { name: "Otro Nombre", phone: "1111 111-111" },
        items: [{ productId, modifiers: [], quantity: 1 }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().order.customer).toEqual({ name: "Lucía Paz", phone: "3491 444-555" });
  });

  it("direcciones (ADR 0034): Casa, Trabajo y otras, hasta 5, solo las propias", async () => {
    const { token } = await ctx.tokenFor();
    const add = (payload: Body, t = token) => req("POST", "/v1/customer/me/addresses", { token: t, payload });
    const me = async () => (await req("GET", "/v1/customer/me", { token })).json();

    // Sin registro no hay direcciones.
    expect((await add({ label: "HOME", line: "Belgrano 456" })).json().error.details.reason).toBe("PROFILE_REQUIRED");
    expect((await req("PUT", "/v1/customer/me", { token, payload: { displayName: "Ana Gómez", phone: "3491 555-111" } })).json().addresses).toEqual([]);

    const work = await add({ label: "WORK", line: "San Martín 900", name: "ignorado" });
    expect(work.statusCode).toBe(201);
    expect(work.json()).toMatchObject({ label: "WORK", name: null, notes: null, location: null });
    const home = (await add({ label: "HOME", line: " Belgrano 456 ", notes: "Timbre B", location: { lat: -29.24, lng: -61.77 } })).json();
    expect(home).toMatchObject({ label: "HOME", line: "Belgrano 456", notes: "Timbre B", location: { lat: -29.24, lng: -61.77 } });
    expect((await add({ label: "HOME", line: "Otra casa" })).json().error.details.reason).toBe("ADDRESS_LABEL_TAKEN");
    expect((await add({ label: "OTHER", line: "Mitre 10", location: { lat: 200, lng: 0 } })).statusCode).toBe(400);

    await add({ label: "OTHER", line: "Mitre 10", name: "Casa de mamá" });
    await add({ label: "OTHER", line: "Rivadavia 20" });
    await add({ label: "OTHER", line: "Sarmiento 30" });
    expect((await add({ label: "OTHER", line: "Moreno 40" })).json().error.details.reason).toBe("ADDRESS_LIMIT");

    // Casa primero, después Trabajo y las otras por antigüedad.
    const list = (await me()).addresses as Array<{ label: string; name: string | null; line: string }>;
    expect(list.map((a) => [a.label, a.name ?? a.line])).toEqual([
      ["HOME", "Belgrano 456"],
      ["WORK", "San Martín 900"],
      ["OTHER", "Casa de mamá"],
      ["OTHER", "Rivadavia 20"],
      ["OTHER", "Sarmiento 30"],
    ]);

    // Editar: no puede pasar a ser una segunda Casa; sí cambiar sus datos.
    const edit = (id: string, payload: Body, t = token) => req("PUT", `/v1/customer/me/addresses/${id}`, { token: t, payload });
    expect((await edit(work.json().id, { label: "HOME", line: "San Martín 900" })).json().error.details.reason).toBe("ADDRESS_LABEL_TAKEN");
    expect((await edit(home.id, { label: "HOME", line: "Belgrano 458" })).json()).toMatchObject({ line: "Belgrano 458", notes: null, location: null });

    // Las de otro cliente no se ven, no se editan ni se borran.
    const other = await ctx.customerToken();
    expect((await edit(home.id, { label: "HOME", line: "X 1" }, other)).statusCode).toBe(404);
    expect((await req("DELETE", `/v1/customer/me/addresses/${home.id}`, { token: other })).statusCode).toBe(404);

    expect((await req("DELETE", `/v1/customer/me/addresses/${home.id}`, { token })).statusCode).toBe(204);
    expect((await me()).addresses).toHaveLength(4);
    expect((await add({ label: "HOME", line: "Nueva casa 1" })).statusCode).toBe(201);
  });
});
