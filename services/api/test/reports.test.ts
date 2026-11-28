import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
/** Cliente registrado: solo así se puede pedir (ADR 0026). */
let buyer: string;
let admin: string;
let owner: string;
let stranger: string;
let merchantId: string;
let branchId: string;
let pizzaId: string;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

let keySeq = 0;
/** Pedido de `quantity` pizzas de $9.000 (retiro, efectivo). */
const order = async (quantity: number) => {
  const res = await req("POST", "/v1/public/orders", {
    token: buyer,
    headers: { "idempotency-key": `reports-${++keySeq}-${Date.now()}` },
    payload: {
      merchantSlug: "la-esquina-reportes",
      branchId,
      fulfillmentType: "PICKUP",
      items: [{ productId: pizzaId, modifiers: [], quantity }],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().order.id as string;
};

const transition = (orderId: string, to: string, reason?: string) =>
  req("POST", `/v1/merchants/${merchantId}/orders/${orderId}/transition`, { token: owner, payload: { to, ...(reason && { reason }) } });

const complete = async (orderId: string) => {
  for (const to of ["ACCEPTED", "PREPARING", "READY", "PICKED_UP"]) expect((await transition(orderId, to)).statusCode).toBe(200);
};

const earnings = (days = 7, token = owner) => req("GET", `/v1/merchants/${merchantId}/reports/earnings?days=${days}`, { token });

beforeAll(async () => {
  ctx = await createTestContext();
  buyer = await ctx.customerToken();
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  stranger = (await ctx.tokenFor()).token;

  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (
    await req("POST", "/v1/admin/categories", {
      token: admin,
      payload: { kind: "MERCHANT", name: "Gastronomía", commissionCategory: "GASTRONOMY" },
    })
  ).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "La Esquina Reportes", legalName: "José Pérez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id;
  branchId = (
    await req("POST", `/v1/merchants/${merchantId}/branches`, {
      token: owner,
      payload: { name: "Centro", cityId, addressLine: "San Martín 123", acceptsPickup: true },
    })
  ).json().id;
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" }));
  await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: allDay } });
  await req("POST", `/v1/merchants/${merchantId}/submit`, { token: owner });
  await req("POST", `/v1/admin/merchants/${merchantId}/approve`, { token: admin });
  pizzaId = (
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, {
      token: owner,
      payload: { name: "Muzzarella", priceMinor: 900000, variants: [], modifierGroups: [] },
    })
  ).json().id;
});
afterAll(() => ctx.close());

describe("reporte de ganancias", () => {
  it("sin pedidos: período con todos los días en cero", async () => {
    const res = await earnings(7);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.days).toHaveLength(7);
    expect(body.days.at(-1).date).toBe(body.to);
    expect(body.totals).toMatchObject({ orders: 0, salesMinor: 0, netMinor: 0, averageTicketMinor: null });
  });

  it("cuenta solo pedidos completados: ventas, comisión, neto y acumulado del día", async () => {
    await complete(await order(1)); // $9.000
    await complete(await order(2)); // $18.000
    const rejected = await order(1);
    expect((await transition(rejected, "REJECTED", "Sin stock")).statusCode).toBe(200);
    await order(3); // queda esperando: no cuenta

    const body = (await earnings(7)).json();
    expect(body.totals.orders).toBe(2);
    expect(body.totals.salesMinor).toBe(2_700_000);
    expect(body.totals.commissionMinor).toBeGreaterThan(0);
    expect(body.totals.netMinor).toBe(body.totals.salesMinor - body.totals.commissionMinor - body.totals.refundsMinor);
    expect(body.totals.averageTicketMinor).toBe(1_350_000);
    expect(body.salesByPaymentMethod.CASH).toBe(2_700_000);

    const today = body.days.at(-1);
    expect(today).toMatchObject({ orders: 2, salesMinor: 2_700_000 });
    expect(today.cumulativeNetMinor).toBe(body.totals.netMinor);
    expect(body.previous.orders).toBe(0);
  });

  it("solo los miembros del comercio ven el reporte", async () => {
    // Igual que el resto del módulo de comercios: a un extraño no se le confirma que el comercio existe.
    expect((await earnings(7, stranger)).statusCode).toBe(404);
  });

  it("valida el rango de días", async () => {
    expect((await earnings(0)).statusCode).toBe(400);
    expect((await earnings(400)).statusCode).toBe(400);
  });
});
