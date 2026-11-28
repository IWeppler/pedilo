import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { orderEvents } from "../src/db/schema";
import { bearer, createTestContext, type TestContext } from "./helpers";

/** Calificaciones de comercios (ADR 0031). */

let ctx: TestContext;
let owner: string;
let merchantId: string;
let branchId: string;
let productId: string;
let seq = 0;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

/** Pedido de retiro del cliente; con `complete`, ya retirado. */
async function order(buyer: string, complete = true) {
  const res = await req("POST", "/v1/public/orders", {
    token: buyer,
    headers: { "idempotency-key": `rating-${++seq}-${Date.now()}` },
    payload: { merchantSlug: "heladeria-estrellas", branchId, fulfillmentType: "PICKUP", items: [{ productId, modifiers: [], quantity: 1 }] },
  });
  const id = res.json().order.id as string;
  if (complete) {
    for (const to of ["ACCEPTED", "PREPARING", "READY", "PICKED_UP"]) {
      await req("POST", `/v1/merchants/${merchantId}/orders/${id}/transition`, { token: owner, payload: { to } });
    }
  }
  return id;
}
const rate = (buyer: string, orderId: string, payload: Body) => req("POST", `/v1/customer/orders/${orderId}/rating`, { token: buyer, payload });
const cityRating = async () => ((await req("GET", "/v1/public/cities/tostado/merchants")).json() as Array<{ rating: unknown }>)[0]!.rating;

beforeAll(async () => {
  ctx = await createTestContext();
  const admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Heladería Estrellas", legalName: "Ana Gómez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
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
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, { token: owner, payload: { name: "Cuarto de helado", priceMinor: 500_000, variants: [], modifierGroups: [] } })
  ).json().id;
});
afterAll(() => ctx.close());

describe("calificaciones (ADR 0031)", () => {
  it("solo quien pidió, con el pedido terminado y una vez", async () => {
    const buyer = await ctx.customerToken();
    const pending = await order(buyer, false);
    expect((await rate(buyer, pending, { stars: 5 })).json().error.details.reason).toBe("ORDER_NOT_COMPLETED");

    const done = await order(buyer);
    expect((await rate(await ctx.customerToken(), done, { stars: 5 })).statusCode).toBe(404);
    expect((await rate(buyer, done, { stars: 6 })).statusCode).toBe(400);
    const ok = await rate(buyer, done, { stars: 4, comment: "  Rico, pero tardó un poco  " });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ orderId: done, stars: 4 });
    expect((await rate(buyer, done, { stars: 5 })).json().error.details.reason).toBe("RATING_EXISTS");

    // «Mis pedidos»: la calificación y hasta cuándo se puede calificar.
    const mine = (await req("GET", "/v1/customer/orders", { token: buyer })).json() as Array<{ id: string; rating: number | null; ratableUntil: string | null }>;
    expect(mine.find((o) => o.id === done)).toMatchObject({ rating: 4, ratableUntil: null });
    expect(mine.find((o) => o.id === pending)).toMatchObject({ rating: null, ratableUntil: null });
  });

  it("plazo de 14 días desde el retiro", async () => {
    const buyer = await ctx.customerToken();
    const id = await order(buyer);
    const listed = (await req("GET", "/v1/customer/orders", { token: buyer })).json() as Array<{ id: string; ratableUntil: string | null }>;
    expect(listed.find((o) => o.id === id)!.ratableUntil).not.toBeNull();
    // Se retiró hace 15 días.
    await ctx.db.update(orderEvents).set({ createdAt: new Date(Date.now() - 15 * 86_400_000) }).where(eq(orderEvents.orderId, id));
    expect((await rate(buyer, id, { stars: 5 })).json().error.details.reason).toBe("RATING_WINDOW_CLOSED");
  });

  it("el promedio es público recién con 5; el comercio ve todo, con comentarios", async () => {
    // Ya hay una de 4 estrellas. Con 4 calificaciones todavía no se publica.
    const rateNew = async (stars: number, comment?: string) => {
      const buyer = await ctx.customerToken();
      const id = await order(buyer);
      expect((await rate(buyer, id, { stars, ...(comment && { comment }) })).statusCode).toBe(201);
    };
    for (const stars of [5, 5, 4]) await rateNew(stars);
    expect(await cityRating()).toBeNull();
    expect((await req("GET", "/v1/public/merchants/heladeria-estrellas")).json().rating).toBeNull();

    await rateNew(5, "El mejor de Tostado");
    // 4, 5, 5, 4, 5 → 4,6
    expect(await cityRating()).toEqual({ average: 4.6, count: 5 });
    expect((await req("GET", "/v1/public/merchants/heladeria-estrellas")).json().rating).toEqual({ average: 4.6, count: 5 });

    const panel = (await req("GET", `/v1/merchants/${merchantId}/ratings`, { token: owner })).json();
    expect(panel).toMatchObject({ public: true, summary: { average: 4.6, count: 5, distribution: [0, 0, 0, 2, 3] } });
    expect(panel.recent[0]).toMatchObject({ stars: 5, comment: "El mejor de Tostado", orderCode: expect.stringMatching(/^P-/) });
    expect(panel.recent.map((r: { comment: string | null }) => r.comment)).toContain("Rico, pero tardó un poco");
    // Otro usuario no ve las calificaciones del comercio; el público nunca ve comentarios.
    expect((await req("GET", `/v1/merchants/${merchantId}/ratings`, { token: (await ctx.tokenFor()).token })).statusCode).toBe(404);
    expect(JSON.stringify((await req("GET", "/v1/public/merchants/heladeria-estrellas")).json())).not.toContain("El mejor de Tostado");
  });
});
