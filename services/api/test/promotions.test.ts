import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearer, createTestContext, type TestContext } from "./helpers";

/** Promociones del comercio (ADR 0030): ofertas automáticas y cupones con código. */

let ctx: TestContext;
let admin: string;
let owner: string;
let merchantId: string;
let branchId: string;
let pizza: string; // $9.000
let coca: string; // $1.500
let seq = 0;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

const promo = (payload: Body, token = owner) => req("POST", `/v1/merchants/${merchantId}/promotions`, { token, payload });
const orderBody = (items: Array<[string, number]>, couponCode?: string) => ({
  merchantSlug: "pizzeria-promo",
  branchId,
  fulfillmentType: "PICKUP",
  items: items.map(([productId, quantity]) => ({ productId, modifiers: [], quantity })),
  ...(couponCode && { couponCode }),
});
const placeOrder = (token: string, items: Array<[string, number]>, couponCode?: string) =>
  req("POST", "/v1/public/orders", { token, headers: { "idempotency-key": `promo-${++seq}-${Date.now()}` }, payload: orderBody(items, couponCode) });
const quote = (token: string, items: Array<[string, number]>, couponCode?: string) =>
  req("POST", "/v1/public/orders/quote", { token, payload: orderBody(items, couponCode) });

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Pizzería Promo", legalName: "Ana Gómez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
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
  const product = async (name: string, priceMinor: number) =>
    (await req("POST", `/v1/merchants/${merchantId}/menu/products`, { token: owner, payload: { name, priceMinor, variants: [], modifierGroups: [] } })).json()
      .id as string;
  pizza = await product("Muzzarella", 900_000);
  coca = await product("Coca 1,5 L", 150_000);
});
afterAll(() => ctx.close());

describe("promociones del comercio (ADR 0030)", () => {
  let offerId: string;

  it("el dueño crea ofertas y cupones; valida y normaliza", async () => {
    const offer = await promo({ kind: "OFFER", title: "20% en pizzas", discountType: "PERCENT", value: 20, productIds: [pizza] });
    expect(offer.statusCode).toBe(201);
    offerId = offer.json().id;
    expect(offer.json()).toMatchObject({ label: "20% off", productIds: [pizza], live: true, code: null, perCustomerLimit: null });

    const coupon = await promo({ kind: "COUPON", code: " bienvenida 30 ", title: "Bienvenida", discountType: "PERCENT", value: 30 });
    expect(coupon.json()).toMatchObject({ code: "BIENVENIDA30", perCustomerLimit: 1, productIds: null });

    expect((await promo({ kind: "COUPON", code: "BIENVENIDA30", title: "Otra", discountType: "FIXED", value: 100_000 })).json().error.details.reason).toBe(
      "CODE_TAKEN",
    );
    expect((await promo({ kind: "OFFER", title: "Mucho", discountType: "PERCENT", value: 95 })).statusCode).toBe(400);
    expect((await promo({ kind: "COUPON", code: "x", title: "Corto", discountType: "PERCENT", value: 10 })).statusCode).toBe(400);
    expect((await promo({ kind: "OFFER", title: "Ajeno", discountType: "PERCENT", value: 10, productIds: ["00000000-0000-4000-8000-000000000000"] })).statusCode).toBe(400);
    // Otro usuario: el comercio no existe para él.
    expect((await promo({ kind: "OFFER", title: "Intruso", discountType: "PERCENT", value: 10 }, (await ctx.tokenFor()).token)).statusCode).toBe(404);

    const list = (await req("GET", `/v1/merchants/${merchantId}/promotions`, { token: owner })).json() as Array<{ title: string }>;
    expect(list.map((p) => p.title)).toEqual(["Bienvenida", "20% en pizzas"]);
  });

  it("la app ve las ofertas (nunca los cupones)", async () => {
    const menu = (await req("GET", "/v1/public/merchants/pizzeria-promo")).json();
    expect(menu.offers.map((o: { title: string }) => o.title)).toEqual(["20% en pizzas"]);
    const list = (await req("GET", "/v1/public/cities/tostado/merchants")).json() as Array<{ offer: { label: string } | null }>;
    expect(list[0]!.offer).toMatchObject({ label: "20% off" });
    const banner = (await req("GET", "/v1/public/cities/tostado/offers")).json();
    expect(banner).toEqual([expect.objectContaining({ merchant: expect.objectContaining({ slug: "pizzeria-promo" }), offer: expect.objectContaining({ title: "20% en pizzas" }) })]);
    expect(JSON.stringify([menu, list, banner])).not.toContain("BIENVENIDA30");
  });

  it("el pedido lleva la oferta: total y comisión sobre lo descontado", async () => {
    const buyer = await ctx.customerToken();
    const res = await placeOrder(buyer, [[pizza, 2], [coca, 1]]);
    expect(res.statusCode).toBe(201);
    // 20% de $18.000 en pizzas = $3.600. Total = 19.500 − 3.600.
    expect(res.json().order).toMatchObject({
      subtotalMinor: 1_950_000,
      discountMinor: 360_000,
      totalMinor: 1_590_000,
      promotion: { title: "20% en pizzas", label: "20% off", code: null },
    });
    const orders = (await req("GET", `/v1/merchants/${merchantId}/orders?scope=active`, { token: owner })).json() as Array<{
      id: string;
      commission: { basisMinor: number };
    }>;
    expect(orders.find((o) => o.id === res.json().order.id)!.commission.basisMinor).toBe(1_590_000);
  });

  it("cotización: cupón mejor, cupón peor que la oferta y cupones que no sirven", async () => {
    const buyer = await ctx.customerToken();
    // Sin cupón: la oferta.
    expect((await quote(buyer, [[pizza, 1]])).json()).toMatchObject({ discountMinor: 180_000, promotion: { title: "20% en pizzas" }, couponError: null });
    // El cupón del 30% descuenta más.
    expect((await quote(buyer, [[pizza, 1]], "bienvenida30")).json()).toMatchObject({
      discountMinor: 270_000,
      totalMinor: 630_000,
      promotion: { code: "BIENVENIDA30" },
      couponOutdone: false,
    });
    // Un cupón de $1.000 es peor que el 20%: queda la oferta y se avisa.
    await promo({ kind: "COUPON", code: "MIL", title: "Mil pesos", discountType: "FIXED", value: 100_000 });
    expect((await quote(buyer, [[pizza, 1]], "MIL")).json()).toMatchObject({ discountMinor: 180_000, couponOutdone: true, promotion: { code: null } });
    // Inexistente, mínimo no alcanzado, vencido.
    expect((await quote(buyer, [[pizza, 1]], "NOEXISTE")).json().couponError).toMatchObject({ reason: "COUPON_INVALID" });
    await promo({ kind: "COUPON", code: "GRANDE", title: "Pedido grande", discountType: "FIXED", value: 500_000, minSubtotalMinor: 3_000_000 });
    expect((await quote(buyer, [[pizza, 1]], "GRANDE")).json().couponError).toMatchObject({ reason: "COUPON_MIN_NOT_MET" });
    await promo({
      kind: "COUPON",
      code: "VIEJO",
      title: "Vencido",
      discountType: "PERCENT",
      value: 50,
      startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect((await quote(buyer, [[pizza, 1]], "VIEJO")).json().couponError).toMatchObject({ reason: "COUPON_EXPIRED" });
    // Al pedir, un cupón que no sirve corta (409); la cotización no.
    expect((await placeOrder(buyer, [[pizza, 1]], "NOEXISTE")).json().error.details.reason).toBe("COUPON_INVALID");
  });

  it("un uso por cliente; si el pedido no sigue, vuelve al cupo", async () => {
    const buyer = await ctx.customerToken();
    const first = await placeOrder(buyer, [[coca, 2]], "BIENVENIDA30");
    expect(first.json().order).toMatchObject({ discountMinor: 90_000, promotion: { code: "BIENVENIDA30" } });
    expect((await placeOrder(buyer, [[coca, 2]], "BIENVENIDA30")).json().error.details.reason).toBe("COUPON_ALREADY_USED");
    // El comercio lo rechaza: el cupón se puede volver a usar.
    const reject = await req("POST", `/v1/merchants/${merchantId}/orders/${first.json().order.id}/transition`, {
      token: owner,
      payload: { to: "REJECTED", reason: "Sin stock" },
    });
    expect(reject.statusCode).toBe(200);
    expect((await placeOrder(buyer, [[coca, 2]], "BIENVENIDA30")).statusCode).toBe(201);
  });

  it("cupo total: dos pedidos simultáneos con el último uso, entra uno solo", async () => {
    await promo({ kind: "COUPON", code: "UNICO", title: "Uno solo", discountType: "FIXED", value: 50_000, maxRedemptions: 1, perCustomerLimit: null });
    const [a, b] = await Promise.all([
      placeOrder(await ctx.customerToken(), [[coca, 1]], "UNICO"),
      placeOrder(await ctx.customerToken(), [[coca, 1]], "UNICO"),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const lost = a.statusCode === 409 ? a : b;
    expect(lost.json().error.details.reason).toBe("COUPON_EXHAUSTED");
    const list = (await req("GET", `/v1/merchants/${merchantId}/promotions`, { token: owner })).json() as Array<{ code: string | null; redemptionsCount: number; live: boolean }>;
    expect(list.find((p) => p.code === "UNICO")).toMatchObject({ redemptionsCount: 1, live: false });
  });

  it("pausar la oferta la saca de la app y de los pedidos", async () => {
    const res = await req("PUT", `/v1/merchants/${merchantId}/promotions/${offerId}`, {
      token: owner,
      payload: { kind: "OFFER", title: "20% en pizzas", discountType: "PERCENT", value: 20, productIds: [pizza], active: false },
    });
    expect(res.json()).toMatchObject({ active: false, live: false });
    expect((await req("GET", "/v1/public/merchants/pizzeria-promo")).json().offers).toEqual([]);
    const order = await placeOrder(await ctx.customerToken(), [[pizza, 1]]);
    expect(order.json().order).toMatchObject({ discountMinor: 0, promotion: null, totalMinor: 900_000 });
    // No se puede cambiar una oferta por un cupón.
    const kind = await req("PUT", `/v1/merchants/${merchantId}/promotions/${offerId}`, {
      token: owner,
      payload: { kind: "COUPON", code: "CAMBIO", title: "x", discountType: "PERCENT", value: 20 },
    });
    expect(kind.statusCode).toBe(400);
  });
});
