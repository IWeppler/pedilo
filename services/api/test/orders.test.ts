import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createOrder } from "../src/modules/orders/service";
import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: string;
let owner: string;
let stranger: string;
let merchantId: string;
let branchId: string;
let zoneId: string;
let pizza: {
  id: string;
  variants: Array<{ id: string; name: string }>;
  modifierGroups: Array<{ id: string; name: string; modifiers: Array<{ id: string; name: string }> }>;
};
let cokeId: string;
let pausedId: string;

type Body = Record<string, unknown>;
const req = (
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {},
) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

let keySeq = 0;
const newKey = () => `test-key-${++keySeq}-${Date.now()}`;

const placeOrder = (body: Body, key = newKey()) =>
  req("POST", "/v1/public/orders", { payload: body, headers: { "idempotency-key": key } });

const pickupBody = (over: Body = {}): Body => ({
  merchantSlug: "pizzeria-don-pepe",
  branchId,
  fulfillmentType: "PICKUP",
  customer: { name: "Ana Gómez", phone: "3491 555-123" },
  items: [
    {
      productId: pizza.id,
      variantId: pizza.variants[1]!.id, // Grande $9.000
      modifiers: [
        { modifierId: pizza.modifierGroups[0]!.modifiers[1]!.id, quantity: 1 }, // Integral +$500
        { modifierId: pizza.modifierGroups[1]!.modifiers[0]!.id, quantity: 2 }, // Extra queso 2 × $800
      ],
      quantity: 2,
      notes: "Bien cocida",
    },
    { productId: cokeId, modifiers: [], quantity: 1 },
  ],
  ...over,
});

const ALL_DAY = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" }));

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  stranger = (await ctx.tokenFor()).token;

  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Pizzería Don Pepe", legalName: "José Pérez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id;
  branchId = (
    await req("POST", `/v1/merchants/${merchantId}/branches`, {
      token: owner,
      payload: { name: "Centro", cityId, addressLine: "San Martín 123", acceptsPickup: true, acceptsDelivery: true },
    })
  ).json().id;
  await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: ALL_DAY } });
  zoneId = (
    await req("POST", `/v1/merchants/${merchantId}/branches/${branchId}/zones`, {
      token: owner,
      payload: { name: "Centro", feeMinor: 150000, minOrderMinor: 1000000 },
    })
  ).json().id;
  await req("POST", `/v1/merchants/${merchantId}/submit`, { token: owner });
  await req("POST", `/v1/admin/merchants/${merchantId}/approve`, { token: admin });

  const menu = `/v1/merchants/${merchantId}/menu/products`;
  pizza = (
    await req("POST", menu, {
      token: owner,
      payload: {
        name: "Muzzarella",
        priceMinor: 900000,
        variants: [
          { name: "Chica", priceMinor: 600000 },
          { name: "Grande", priceMinor: 900000 },
        ],
        modifierGroups: [
          { name: "Masa", minSelect: 1, maxSelect: 1, modifiers: [{ name: "Común", priceDeltaMinor: 0 }, { name: "Integral", priceDeltaMinor: 50000 }] },
          { name: "Extras", minSelect: 0, maxSelect: 3, modifiers: [{ name: "Extra queso", priceDeltaMinor: 80000, maxQuantity: 2 }] },
        ],
      },
    })
  ).json();
  cokeId = (await req("POST", menu, { token: owner, payload: { name: "Coca-Cola 1,5 L", priceMinor: 350000, variants: [], modifierGroups: [] } })).json().id;
  pausedId = (
    await req("POST", menu, { token: owner, payload: { name: "Fainá", priceMinor: 100000, available: false, variants: [], modifierGroups: [] } })
  ).json().id;
});
afterAll(() => ctx.close());

describe("crear pedido (invitado)", () => {
  it("recalcula precios en el servidor y guarda snapshots", async () => {
    const res = await placeOrder(pickupBody());
    expect(res.statusCode).toBe(201);
    const { order, trackingToken, replayed } = res.json();
    expect(replayed).toBe(false);
    expect(trackingToken).toEqual(expect.any(String));
    expect(order).toMatchObject({
      status: "PLACED",
      code: expect.stringMatching(/^P-[A-Z2-9]{4}$/),
      fulfillmentType: "PICKUP",
      paymentMethod: "CASH",
      paymentStatus: "PENDING",
      merchant: { name: "Pizzería Don Pepe" },
      branch: { name: "Centro", address: "San Martín 123" },
      customer: { name: "Ana Gómez" },
      delivery: null,
      // (9.000 + 500 + 1.600) × 2 + 3.500 = 25.700
      subtotalMinor: 2570000,
      deliveryFeeMinor: 0,
      totalMinor: 2570000,
    });
    expect(order.items[0]).toMatchObject({
      productName: "Muzzarella",
      variantName: "Grande",
      unitPriceMinor: 1110000,
      quantity: 2,
      totalMinor: 2220000,
      notes: "Bien cocida",
      options: [
        { groupName: "Masa", name: "Integral", quantity: 1, priceDeltaMinor: 50000 },
        { groupName: "Extras", name: "Extra queso", quantity: 2, priceDeltaMinor: 80000 },
      ],
    });
    expect(order.events).toEqual([expect.objectContaining({ fromStatus: null, toStatus: "PLACED", actorType: "CUSTOMER" })]);
  });

  it("la misma Idempotency-Key devuelve el mismo pedido y el mismo token", async () => {
    const key = newKey();
    const first = (await placeOrder(pickupBody(), key)).json();
    const again = (await placeOrder(pickupBody(), key)).json();
    expect(again.replayed).toBe(true);
    expect(again.order.id).toBe(first.order.id);
    expect(again.trackingToken).toBe(first.trackingToken);
  });

  it("sin Idempotency-Key → 400", async () => {
    const res = await req("POST", "/v1/public/orders", { payload: pickupBody() });
    expect(res.statusCode).toBe(400);
  });

  it("selección inválida, producto pausado o inexistente → 409 con el ítem", async () => {
    const noMasa = await placeOrder(
      pickupBody({ items: [{ productId: pizza.id, variantId: pizza.variants[0]!.id, modifiers: [], quantity: 1 }] }),
    );
    expect(noMasa.statusCode).toBe(409);
    expect(noMasa.json().error.details).toMatchObject({
      reason: "ITEM_INVALID",
      itemIndex: 0,
      errors: [{ error: "GROUP_MIN_NOT_MET", ref: pizza.modifierGroups[0]!.id }],
    });

    const paused = await placeOrder(pickupBody({ items: [{ productId: pausedId, modifiers: [], quantity: 1 }] }));
    expect(paused.json().error.details).toMatchObject({ reason: "ITEM_INVALID", errors: [{ error: "PRODUCT_UNAVAILABLE" }] });

    const unknown = await placeOrder(pickupBody({ items: [{ productId: crypto.randomUUID(), modifiers: [], quantity: 1 }] }));
    expect(unknown.json().error.details).toMatchObject({ reason: "PRODUCT_UNAVAILABLE", itemIndex: 0 });
  });

  it("envío: exige zona y dirección, respeta el mínimo y suma el costo", async () => {
    const delivery = (over: Body = {}) =>
      pickupBody({ fulfillmentType: "DELIVERY", deliveryZoneId: zoneId, deliveryAddress: { line: "Belgrano 456", notes: "Timbre B" }, ...over });

    expect((await placeOrder(delivery({ deliveryZoneId: undefined }))).statusCode).toBe(400);

    const small = await placeOrder(delivery({ items: [{ productId: cokeId, modifiers: [], quantity: 1 }] }));
    expect(small.statusCode).toBe(409);
    expect(small.json().error.details).toMatchObject({ reason: "MIN_ORDER_NOT_MET", minOrderMinor: 1000000, subtotalMinor: 350000 });

    const ok = await placeOrder(delivery());
    expect(ok.statusCode).toBe(201);
    expect(ok.json().order).toMatchObject({
      deliveryFeeMinor: 150000,
      totalMinor: 2720000,
      delivery: { zoneName: "Centro", addressLine: "Belgrano 456", addressNotes: "Timbre B" },
    });
  });

  it("sucursal cerrada → 409 BRANCH_CLOSED (con hora fija)", async () => {
    const merchantRanges = [{ weekday: 1, opensAt: "09:00", closesAt: "13:00" }];
    await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: merchantRanges } });
    try {
      // Martes 2026-12-01 10:00 en Argentina (13:00 UTC): la sucursal abre solo los lunes.
      await expect(
        createOrder(ctx.db, pickupBody() as never, newKey(), { secret: "x".repeat(16), now: new Date("2026-12-01T13:00:00Z") }),
      ).rejects.toMatchObject({ statusCode: 409, details: { reason: "BRANCH_CLOSED" } });
    } finally {
      await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: ALL_DAY } });
    }
  });

  it("comercio inexistente o no aprobado → 404", async () => {
    expect((await placeOrder(pickupBody({ merchantSlug: "no-existe" }))).statusCode).toBe(404);
  });
});

describe("seguimiento y cancelación del cliente", () => {
  it("con el token se ve el pedido; con otro token o sin él, no", async () => {
    const { order, trackingToken } = (await placeOrder(pickupBody())).json();
    const ok = await req("GET", `/v1/public/orders/${order.id}`, { headers: { "x-order-token": trackingToken } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(order.id);

    const wrong = await req("GET", `/v1/public/orders/${order.id}`, { headers: { "x-order-token": "x".repeat(43) } });
    expect(wrong.statusCode).toBe(404);
    expect((await req("GET", `/v1/public/orders/${order.id}`)).statusCode).toBe(400);
  });

  it("puede cancelar antes de la aceptación, no después", async () => {
    const a = (await placeOrder(pickupBody())).json();
    const cancelled = await req("POST", `/v1/public/orders/${a.order.id}/cancel`, { headers: { "x-order-token": a.trackingToken }, payload: {} });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: "CANCELLED", statusReason: "Cancelado por el cliente" });

    const b = (await placeOrder(pickupBody())).json();
    await req("POST", `/v1/merchants/${merchantId}/orders/${b.order.id}/transition`, { token: owner, payload: { to: "ACCEPTED" } });
    const late = await req("POST", `/v1/public/orders/${b.order.id}/cancel`, { headers: { "x-order-token": b.trackingToken }, payload: {} });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.details.reason).toBe("NOT_CANCELLABLE");
  });
});

describe("gestión del comercio", () => {
  it("flujo de retiro: aceptar → preparar → listo (pasa solo a «listo para retirar») → retirado", async () => {
    const { order, trackingToken } = (await placeOrder(pickupBody())).json();
    const go = (to: string, reason?: string) =>
      req("POST", `/v1/merchants/${merchantId}/orders/${order.id}/transition`, { token: owner, payload: { to, ...(reason && { reason }) } });

    expect((await go("PREPARING")).statusCode).toBe(409); // todavía no fue aceptado
    expect((await go("ACCEPTED")).json().status).toBe("ACCEPTED");
    expect((await go("PREPARING")).json().status).toBe("PREPARING");
    const ready = (await go("READY")).json();
    expect(ready.status).toBe("READY_FOR_PICKUP");
    expect(ready.events.slice(-2).map((e: { toStatus: string; actorType: string }) => [e.toStatus, e.actorType])).toEqual([
      ["READY", "MERCHANT"],
      ["READY_FOR_PICKUP", "SYSTEM"],
    ]);

    const active = (await req("GET", `/v1/merchants/${merchantId}/orders?scope=active`, { token: owner })).json();
    expect(active.map((o: { id: string }) => o.id)).toContain(order.id);

    expect((await go("PICKED_UP")).json().status).toBe("PICKED_UP");
    const done = (await req("GET", `/v1/merchants/${merchantId}/orders?scope=done`, { token: owner })).json();
    expect(done.map((o: { id: string }) => o.id)).toContain(order.id);

    // El cliente ve el historial completo.
    const tracked = (await req("GET", `/v1/public/orders/${order.id}`, { headers: { "x-order-token": trackingToken } })).json();
    expect(tracked.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      "PLACED",
      "ACCEPTED",
      "PREPARING",
      "READY",
      "READY_FOR_PICKUP",
      "PICKED_UP",
    ]);
  });

  it("rechazar exige motivo, y el cliente lo ve", async () => {
    const { order, trackingToken } = (await placeOrder(pickupBody())).json();
    const url = `/v1/merchants/${merchantId}/orders/${order.id}/transition`;
    expect((await req("POST", url, { token: owner, payload: { to: "REJECTED" } })).statusCode).toBe(400);
    const rejected = await req("POST", url, { token: owner, payload: { to: "REJECTED", reason: "Nos quedamos sin muzzarella" } });
    expect(rejected.json()).toMatchObject({ status: "REJECTED", statusReason: "Nos quedamos sin muzzarella" });
    const tracked = (await req("GET", `/v1/public/orders/${order.id}`, { headers: { "x-order-token": trackingToken } })).json();
    expect(tracked.statusReason).toBe("Nos quedamos sin muzzarella");
  });

  it("envío: listo → salió → entregado", async () => {
    const { order } = (
      await placeOrder(pickupBody({ fulfillmentType: "DELIVERY", deliveryZoneId: zoneId, deliveryAddress: { line: "Belgrano 456" } }))
    ).json();
    const go = (to: string) => req("POST", `/v1/merchants/${merchantId}/orders/${order.id}/transition`, { token: owner, payload: { to } });
    for (const to of ["ACCEPTED", "PREPARING", "READY", "PICKED_UP_BY_COURIER", "DELIVERED"]) {
      expect((await go(to)).json().status).toBe(to);
    }
    expect((await go("READY_FOR_PICKUP")).statusCode).toBe(409);
  });

  it("un usuario ajeno no ve ni toca pedidos del comercio", async () => {
    const { order } = (await placeOrder(pickupBody())).json();
    expect((await req("GET", `/v1/merchants/${merchantId}/orders`, { token: stranger })).statusCode).toBe(404);
    expect(
      (await req("POST", `/v1/merchants/${merchantId}/orders/${order.id}/transition`, { token: stranger, payload: { to: "ACCEPTED" } })).statusCode,
    ).toBe(404);
  });

  it("editar el menú no cambia pedidos existentes (snapshot)", async () => {
    const { order, trackingToken } = (await placeOrder(pickupBody({ items: [{ productId: cokeId, modifiers: [], quantity: 2 }] }))).json();
    await req("PUT", `/v1/merchants/${merchantId}/menu/products/${cokeId}`, {
      token: owner,
      payload: { name: "Coca-Cola 2,25 L", priceMinor: 500000, variants: [], modifierGroups: [] },
    });
    const tracked = (await req("GET", `/v1/public/orders/${order.id}`, { headers: { "x-order-token": trackingToken } })).json();
    expect(tracked.items[0]).toMatchObject({ productName: "Coca-Cola 1,5 L", unitPriceMinor: 350000, totalMinor: 700000 });
  });
});
