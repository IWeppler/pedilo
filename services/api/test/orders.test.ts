import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { notificationOutbox, orders, pushSubscriptions } from "../src/db/schema";
import { MAX_ATTEMPTS, processOutbox, type PushResult, type PushSender } from "../src/modules/notifications/service";
import {
  createOrder,
  DEFAULT_ACCEPT_TIMEOUT_MS,
  EXPIRED_REASON,
  expireOverdueOrders,
  listBranchSlots,
} from "../src/modules/orders/service";
import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
/** Cliente registrado: solo así se puede pedir (ADR 0026). */
let buyer: string;
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
  req("POST", "/v1/public/orders", {
    token: buyer, payload: body, headers: { "idempotency-key": key } });

/** Lo que recibe `createOrder` (el servicio): la ruta le suma nombre y teléfono del perfil. */
const serviceInput = (over: Body = {}) =>
  ({ ...pickupBody(over), customer: { name: "Ana Gómez", phone: "3491 555-123" } }) as unknown as Parameters<typeof createOrder>[1];

const pickupBody = (over: Body = {}): Body => ({
  merchantSlug: "pizzeria-don-pepe",
  branchId,
  fulfillmentType: "PICKUP",
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
  buyer = await ctx.customerToken({ displayName: "Ana Gómez" });
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
    const res = await req("POST", "/v1/public/orders", {
    token: buyer, payload: pickupBody() });
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
        createOrder(ctx.db, serviceInput(), newKey(), { secret: "x".repeat(16), now: new Date("2026-12-01T13:00:00Z") }),
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

describe("avisos al comercio y vencimiento", () => {
  const pulse = async (token = owner) => req("GET", `/v1/merchants/${merchantId}/orders/pulse`, { token });

  it("el pedido nace con plazo de aceptación y sin ver", async () => {
    const before = Date.now();
    const { order } = (await placeOrder(pickupBody())).json();
    expect(order.acknowledgedAt).toBeNull();
    const deadline = new Date(order.acceptDeadlineAt).getTime();
    expect(deadline).toBeGreaterThanOrEqual(before + DEFAULT_ACCEPT_TIMEOUT_MS - 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + DEFAULT_ACCEPT_TIMEOUT_MS + 1000);
  });

  it("pulse: lista los pedidos esperando, y la versión cambia cuando cambia un pedido", async () => {
    const { order } = (await placeOrder(pickupBody())).json();
    const first = (await pulse()).json();
    expect(first.waiting).toContainEqual(expect.objectContaining({ id: order.id, code: order.code, acknowledged: false }));
    expect(first.activeCount).toBeGreaterThan(0);

    await req("POST", `/v1/merchants/${merchantId}/orders/${order.id}/transition`, { token: owner, payload: { to: "ACCEPTED" } });
    const second = (await pulse()).json();
    expect(second.version).not.toBe(first.version);
    expect(second.waiting.map((w: { id: string }) => w.id)).not.toContain(order.id);
  });

  it("ack: marca como visto una sola vez, ignora pedidos ajenos y apaga la alarma", async () => {
    const { order } = (await placeOrder(pickupBody())).json();
    const ack = (ids: string[], token = owner) =>
      req("POST", `/v1/merchants/${merchantId}/orders/ack`, { token, payload: { orderIds: ids } });

    expect((await ack([order.id, crypto.randomUUID()])).json()).toEqual({ acknowledged: 1 });
    expect((await ack([order.id])).json()).toEqual({ acknowledged: 0 });
    const waiting = (await pulse()).json().waiting.find((w: { id: string }) => w.id === order.id);
    expect(waiting).toMatchObject({ acknowledged: true });
    expect((await ack([order.id], stranger)).statusCode).toBe(404);
  });

  it("aceptar también lo marca como visto", async () => {
    const { order } = (await placeOrder(pickupBody())).json();
    const accepted = (
      await req("POST", `/v1/merchants/${merchantId}/orders/${order.id}/transition`, { token: owner, payload: { to: "ACCEPTED" } })
    ).json();
    expect(accepted.acknowledgedAt).toEqual(expect.any(String));
  });

  it("un usuario ajeno no ve el pulse", async () => {
    expect((await pulse(stranger)).statusCode).toBe(404);
  });

  it("vence solo los pedidos sin aceptar pasado el plazo, una sola vez, y el cliente ve el motivo", async () => {
    const res = (await placeOrder(pickupBody())).json();
    const accepted = (await placeOrder(pickupBody())).json().order;
    await req("POST", `/v1/merchants/${merchantId}/orders/${accepted.id}/transition`, { token: owner, payload: { to: "ACCEPTED" } });

    // Antes del plazo no vence.
    expect(await expireOverdueOrders(ctx.db, new Date(Date.now() + 60_000))).toBe(0);

    const later = new Date(new Date(res.order.acceptDeadlineAt).getTime() + 1000);
    expect(await expireOverdueOrders(ctx.db, later)).toBeGreaterThanOrEqual(1);
    expect(await expireOverdueOrders(ctx.db, later)).toBe(0);

    const seen = (
      await req("GET", `/v1/public/orders/${res.order.id}`, { headers: { "x-order-token": res.trackingToken } })
    ).json();
    expect(seen).toMatchObject({ status: "EXPIRED", statusReason: EXPIRED_REASON });
    expect(seen.events.at(-1)).toMatchObject({ fromStatus: "PLACED", toStatus: "EXPIRED", actorType: "SYSTEM" });

    const stillAccepted = (await req("GET", `/v1/merchants/${merchantId}/orders`, { token: owner })).json();
    expect(stillAccepted.find((o: { id: string }) => o.id === accepted.id)).toMatchObject({ status: "ACCEPTED" });
  });

  it("respeta un plazo configurado al crear", async () => {
    const now = new Date();
    const { order } = await createOrder(ctx.db, serviceInput(), newKey(), {
      secret: "test-order-token-secret",
      acceptTimeoutMs: 5 * 60 * 1000,
      now,
    });
    expect(order.acceptDeadlineAt).toBe(new Date(now.getTime() + 5 * 60 * 1000).toISOString());
  });
});

describe("avisos push (outbox)", () => {
  const sub = (n: number) => ({
    endpoint: `https://push.example.test/sub-${n}-${Date.now()}`,
    keys: { p256dh: "BPubKeyForTestsOnly-0123456789", auth: "authsecret01" },
  });
  const register = (body: ReturnType<typeof sub>, token = owner) =>
    req("POST", `/v1/merchants/${merchantId}/push-subscriptions`, { token, payload: body });
  const fakeSender = (result: (endpoint: string) => PushResult) => {
    const sent: Array<{ endpoint: string; title: string }> = [];
    const sender: PushSender = {
      send: async (s, payload) => {
        sent.push({ endpoint: s.endpoint, title: payload.title });
        return result(s.endpoint);
      },
    };
    return { sender, sent };
  };
  const outboxFor = async (orderId: string) => (await ctx.db.select().from(notificationOutbox).where(eq(notificationOutbox.orderId, orderId)))[0]!;
  const clearSubs = () => ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.merchantId, merchantId));
  // Vacía lo que hayan dejado tests anteriores.
  const drain = () => processOutbox(ctx.db, null, new Date(Date.now() + 3_600_000), 1000);

  it("clave pública: null sin VAPID configurado", async () => {
    expect((await req("GET", "/v1/push/public-key")).json()).toEqual({ publicKey: null });
  });

  it("registrar: solo miembros del comercio, endpoint https, idempotente", async () => {
    await clearSubs();
    const body = sub(1);
    expect((await register(body)).statusCode).toBe(204);
    expect((await register(body)).statusCode).toBe(204);
    expect((await register(body, stranger)).statusCode).toBe(404);
    expect((await register({ ...body, endpoint: "http://inseguro.test/x" })).statusCode).toBe(400);
    const rows = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.merchantId, merchantId));
    expect(rows).toHaveLength(1);
  });

  it("crear un pedido deja el aviso en la outbox y el worker lo envía", async () => {
    await drain();
    await clearSubs();
    await register(sub(2));
    const { order } = (await placeOrder(pickupBody())).json();
    expect(await outboxFor(order.id)).toMatchObject({ kind: "ORDER_PLACED", status: "PENDING" });

    const { sender, sent } = fakeSender(() => ({ ok: true }));
    expect(await processOutbox(ctx.db, sender)).toBe(1);
    expect(sent).toEqual([expect.objectContaining({ title: `Pedido nuevo · ${order.code}` })]);
    expect(await outboxFor(order.id)).toMatchObject({ status: "SENT", deliveredCount: 1, attempts: 1 });
    expect(await processOutbox(ctx.db, sender)).toBe(0);
  });

  it("suscripción vencida (410) se borra; sin dispositivos queda SKIPPED", async () => {
    await clearSubs();
    await register(sub(3));
    const { order } = (await placeOrder(pickupBody())).json();
    const { sender } = fakeSender(() => ({ ok: false, gone: true, error: "HTTP 410" }));
    await processOutbox(ctx.db, sender);
    expect(await outboxFor(order.id)).toMatchObject({ status: "SKIPPED", deliveredCount: 0 });
    expect(await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.merchantId, merchantId))).toHaveLength(0);
  });

  it("errores transitorios: reintenta con espera y falla tras el máximo de intentos", async () => {
    await clearSubs();
    await register(sub(4));
    const { order } = (await placeOrder(pickupBody())).json();
    const { sender, sent } = fakeSender(() => ({ ok: false, gone: false, error: "HTTP 503" }));

    let now = new Date();
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      expect(await processOutbox(ctx.db, sender, now)).toBe(1);
      const row = await outboxFor(order.id);
      expect(row.attempts).toBe(i);
      if (i < MAX_ATTEMPTS) {
        expect(row).toMatchObject({ status: "PENDING", lastError: "HTTP 503" });
        expect(await processOutbox(ctx.db, sender, now)).toBe(0); // todavía no es hora del reintento
        now = row.nextAttemptAt;
      } else {
        expect(row).toMatchObject({ status: "FAILED" });
      }
    }
    expect(sent).toHaveLength(MAX_ATTEMPTS);
  });

  it("sin push configurado, los avisos se omiten (SKIPPED) sin trabar la cola", async () => {
    const { order } = (await placeOrder(pickupBody())).json();
    await processOutbox(ctx.db, null);
    expect(await outboxFor(order.id)).toMatchObject({ status: "SKIPPED" });
  });

  it("aviso de prueba y baja del navegador", async () => {
    await drain();
    await clearSubs();
    const body = sub(5);
    await register(body);
    expect((await req("POST", `/v1/merchants/${merchantId}/push-subscriptions/test`, { token: owner })).statusCode).toBe(202);
    const { sender, sent } = fakeSender(() => ({ ok: true }));
    await processOutbox(ctx.db, sender);
    expect(sent).toEqual([expect.objectContaining({ title: "Pedilo: aviso de prueba", endpoint: body.endpoint })]);

    const remove = await req("POST", `/v1/merchants/${merchantId}/push-subscriptions/remove`, { token: owner, payload: { endpoint: body.endpoint } });
    expect(remove.statusCode).toBe(204);
    expect(await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.merchantId, merchantId))).toHaveLength(0);
  });
});

describe("límites anti-abuso por teléfono (ADR 0010)", () => {
  const secret = "test-order-token-secret";
  const withPhone = (phone: string) =>
    ({ ...pickupBody(), customer: { name: "Abuso", phone } }) as unknown as Parameters<typeof createOrder>[1];

  it("pedidos en curso por teléfono en el comercio: el mismo número con otro formato cuenta igual", async () => {
    const limits = { maxActivePerPhone: 2, maxDailyPerPhone: 0 };
    await createOrder(ctx.db, withPhone("3491 700-001"), newKey(), { secret, limits });
    await createOrder(ctx.db, withPhone("3491700001"), newKey(), { secret, limits });
    const third = createOrder(ctx.db, withPhone("(3491) 700 001"), newKey(), { secret, limits });
    await expect(third).rejects.toMatchObject({ statusCode: 429, code: "RATE_LIMITED", details: { reason: "TOO_MANY_ACTIVE_ORDERS" } });

    // Otro teléfono no se ve afectado.
    await expect(createOrder(ctx.db, withPhone("3491 700-002"), newKey(), { secret, limits })).resolves.toBeTruthy();
  });

  it("un pedido finalizado libera el cupo de pedidos en curso", async () => {
    const limits = { maxActivePerPhone: 1, maxDailyPerPhone: 0 };
    const first = await createOrder(ctx.db, withPhone("3491 700-010"), newKey(), { secret, limits });
    await expect(createOrder(ctx.db, withPhone("3491 700-010"), newKey(), { secret, limits })).rejects.toMatchObject({ statusCode: 429 });
    await req("POST", `/v1/public/orders/${first.order.id}/cancel`, { headers: { "x-order-token": first.trackingToken }, payload: {} });
    await expect(createOrder(ctx.db, withPhone("3491 700-010"), newKey(), { secret, limits })).resolves.toBeTruthy();
  });

  it("máximo diario por teléfono", async () => {
    const limits = { maxActivePerPhone: 0, maxDailyPerPhone: 2 };
    await createOrder(ctx.db, withPhone("3491 700-020"), newKey(), { secret, limits });
    await createOrder(ctx.db, withPhone("3491 700-020"), newKey(), { secret, limits });
    await expect(createOrder(ctx.db, withPhone("3491 700-020"), newKey(), { secret, limits })).rejects.toMatchObject({
      statusCode: 429,
      details: { reason: "DAILY_LIMIT" },
    });
  });

  it("un reintento con la misma Idempotency-Key no cuenta como pedido nuevo", async () => {
    const limits = { maxActivePerPhone: 1, maxDailyPerPhone: 0 };
    const key = newKey();
    const first = await createOrder(ctx.db, withPhone("3491 700-030"), key, { secret, limits });
    const again = await createOrder(ctx.db, withPhone("3491 700-030"), key, { secret, limits });
    expect(again).toMatchObject({ replayed: true, order: { id: first.order.id } });
  });
});

describe("pedidos programados (ADR 0011)", () => {
  const secret = "test-order-token-secret";
  const input = (over: Body = {}) => serviceInput(over);
  // Lunes 2026-11-30 10:00 en Argentina (13:00 UTC). La sucursal abre solo los lunes 12:00–14:00.
  const now = new Date("2026-11-30T13:00:00Z");
  const noon = "2026-11-30T15:00:00.000Z"; // 12:00 local
  const branchUrl = () => `/v1/merchants/${merchantId}/branches/${branchId}`;

  beforeAll(async () => {
    await req("PUT", `${branchUrl()}/hours`, { token: owner, payload: { ranges: [{ weekday: 1, opensAt: "12:00", closesAt: "14:00" }] } });
  });
  afterAll(async () => {
    await req("PUT", `${branchUrl()}/hours`, { token: owner, payload: { ranges: ALL_DAY } });
    await req("PATCH", branchUrl(), { token: owner, payload: { scheduling: { enabled: false, slotCapacity: null } } });
  });

  it("sin programados habilitados → 409 SCHEDULING_DISABLED", async () => {
    await expect(createOrder(ctx.db, input({ scheduledFor: noon }), newKey(), { secret, now })).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: "SCHEDULING_DISABLED" },
    });
  });

  it("el comercio configura la programación (validada)", async () => {
    const bad = await req("PATCH", branchUrl(), { token: owner, payload: { scheduling: { leadMinutes: 5 } } });
    expect(bad.statusCode).toBe(400);
    const res = await req("PATCH", branchUrl(), {
      token: owner,
      payload: { scheduling: { enabled: true, leadMinutes: 60, maxDays: 2, slotCapacity: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scheduling).toEqual({ enabled: true, leadMinutes: 60, maxDays: 2, slotCapacity: 1 });
  });

  it("cerrado ahora: sin franja → BRANCH_CLOSED avisando que se puede programar", async () => {
    await expect(createOrder(ctx.db, input(), newKey(), { secret, now })).rejects.toMatchObject({
      details: { reason: "BRANCH_CLOSED", schedulingAvailable: true },
    });
  });

  it("programa en una franja válida; el plazo de aceptación es 30 min antes", async () => {
    const { order } = await createOrder(ctx.db, input({ scheduledFor: noon }), newKey(), { secret, now });
    expect(order).toMatchObject({ status: "PLACED", scheduledFor: noon, acceptDeadlineAt: "2026-11-30T14:30:00.000Z" });
  });

  it("franja desalineada, fuera de horario o antes de la anticipación → SLOT_UNAVAILABLE", async () => {
    for (const at of ["2026-11-30T15:15:00Z", "2026-11-30T17:00:00Z", "2026-11-30T13:30:00Z", "not-a-date"]) {
      await expect(createOrder(ctx.db, input({ scheduledFor: at }), newKey(), { secret, now })).rejects.toMatchObject({
        details: { reason: "SLOT_UNAVAILABLE" },
      });
    }
  });

  it("respeta el cupo por franja; cancelar libera el lugar", async () => {
    const slot = "2026-11-30T15:30:00.000Z";
    const first = await createOrder(ctx.db, input({ scheduledFor: slot }), newKey(), { secret, now });
    await expect(createOrder(ctx.db, input({ scheduledFor: slot }), newKey(), { secret, now })).rejects.toMatchObject({
      details: { reason: "SLOT_FULL" },
    });
    const slots = await listBranchSlots(ctx.db, "pizzeria-don-pepe", branchId, now);
    expect(slots.slots.find((x) => x.startsAt === slot)).toEqual({ startsAt: slot, available: false });
    expect(slots.slots.find((x) => x.startsAt === "2026-11-30T16:00:00.000Z")?.available).toBe(true);

    await req("POST", `/v1/public/orders/${first.order.id}/cancel`, { headers: { "x-order-token": first.trackingToken }, payload: {} });
    await expect(createOrder(ctx.db, input({ scheduledFor: slot }), newKey(), { secret, now })).resolves.toBeTruthy();
  });

  it("dos pedidos simultáneos a la misma franja: entra uno solo", async () => {
    const slot = "2026-11-30T16:30:00.000Z";
    const results = await Promise.allSettled([
      createOrder(ctx.db, input({ scheduledFor: slot }), newKey(), { secret, now }),
      createOrder(ctx.db, input({ scheduledFor: slot }), newKey(), { secret, now }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("GET .../slots: franjas públicas de la sucursal", async () => {
    const res = await req("GET", `/v1/public/merchants/pizzeria-don-pepe/branches/${branchId}/slots`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ timezone: expect.any(String), slots: expect.any(Array) });
    const missing = await req("GET", `/v1/public/merchants/pizzeria-don-pepe/branches/${merchantId}/slots`);
    expect(missing.statusCode).toBe(404);
  });
});

describe("pago por transferencia y confirmación de cobro (ADR 0011)", () => {
  const settings = `/v1/merchants/${"__ID__"}/payment-settings`;
  const url = () => settings.replace("__ID__", merchantId);
  const order = (over: Body = {}) => placeOrder(pickupBody(over));
  const confirm = (orderId: string, token = owner) =>
    req("POST", `/v1/merchants/${merchantId}/orders/${orderId}/payment/confirm`, { token });

  afterAll(async () => {
    await req("PUT", url(), { token: owner, payload: { acceptsCash: true, acceptsTransfer: false, transfer: null } });
  });

  it("sin transferencia configurada → 409 PAYMENT_METHOD_NOT_AVAILABLE", async () => {
    const res = await order({ paymentMethod: "TRANSFER" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.reason).toBe("PAYMENT_METHOD_NOT_AVAILABLE");
  });

  it("valida la configuración de medios de pago", async () => {
    const put = (payload: Body, token = owner) => req("PUT", url(), { token, payload });
    expect((await put({ acceptsCash: false, acceptsTransfer: false })).statusCode).toBe(400);
    expect((await put({ acceptsCash: true, acceptsTransfer: true, transfer: { holder: "José Pérez" } })).statusCode).toBe(400);
    expect((await put({ acceptsCash: true, acceptsTransfer: true, transfer: { alias: "don.pepe" } })).statusCode).toBe(400);
    expect((await put({ acceptsCash: true, acceptsTransfer: true, transfer: { cbu: "123", holder: "José" } })).statusCode).toBe(400);
    expect((await put({ acceptsCash: true, acceptsTransfer: false }, stranger)).statusCode).not.toBe(200);

    const ok = await put({
      acceptsCash: true,
      acceptsTransfer: true,
      transfer: { alias: " don.pepe.mp ", cbu: "0000003100-0123456789-01", holder: "José Pérez" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().payment).toEqual({
      acceptsCash: true,
      acceptsTransfer: true,
      transfer: { alias: "don.pepe.mp", cbu: "0000003100012345678901", holder: "José Pérez" },
    });
  });

  it("el menú público dice qué medios acepta, sin los datos de la cuenta", async () => {
    const menu = (await req("GET", "/v1/public/merchants/pizzeria-don-pepe")).json();
    expect(menu.merchant.payment).toEqual({ cash: true, transfer: true, card: false });
    expect(JSON.stringify(menu)).not.toContain("don.pepe.mp");
  });

  it("pedido por transferencia: el cliente ve los datos (snapshot) y el comercio confirma una vez", async () => {
    const res = await order({ paymentMethod: "TRANSFER" });
    expect(res.statusCode).toBe(201);
    const { order: created, trackingToken } = res.json();
    expect(created).toMatchObject({
      paymentMethod: "TRANSFER",
      paymentStatus: "PENDING",
      transfer: { alias: "don.pepe.mp", holder: "José Pérez" },
      paymentConfirmedAt: null,
    });

    // Cambiar la cuenta después no cambia el pedido.
    await req("PUT", url(), { token: owner, payload: { acceptsCash: true, acceptsTransfer: true, transfer: { alias: "otro.alias", holder: "Otro" } } });
    const tracked = (await req("GET", `/v1/public/orders/${created.id}`, { headers: { "x-order-token": trackingToken } })).json();
    expect(tracked.transfer.alias).toBe("don.pepe.mp");

    expect((await confirm(created.id, stranger)).statusCode).not.toBe(200);
    const confirmed = await confirm(created.id);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ paymentStatus: "APPROVED", paymentConfirmedAt: expect.any(String) });
    const again = await confirm(created.id);
    expect(again.json().paymentConfirmedAt).toBe(confirmed.json().paymentConfirmedAt);
  });

  it("efectivo rechazado: el pago pasa a cancelado y ya no se confirma; la transferencia sigue confirmable", async () => {
    const reject = (id: string) =>
      req("POST", `/v1/merchants/${merchantId}/orders/${id}/transition`, { token: owner, payload: { to: "REJECTED", reason: "Sin stock" } });

    const cash = (await order()).json().order;
    expect(cash.paymentMethod).toBe("CASH");
    expect((await reject(cash.id)).json().paymentStatus).toBe("CANCELLED");
    const late = await confirm(cash.id);
    expect(late.statusCode).toBe(409);
    expect(late.json().error.details.reason).toBe("INVALID_PAYMENT_STATUS");

    const transfer = (await order({ paymentMethod: "TRANSFER" })).json().order;
    expect((await reject(transfer.id)).json().paymentStatus).toBe("PENDING");
    expect((await confirm(transfer.id)).json().paymentStatus).toBe("APPROVED");
  });

  it("sin efectivo habilitado → 409 al pedir en efectivo", async () => {
    await req("PUT", url(), { token: owner, payload: { acceptsCash: false, acceptsTransfer: true, transfer: { alias: "x.y.z", holder: "José" } } });
    const res = await order();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.reason).toBe("PAYMENT_METHOD_NOT_AVAILABLE");
  });
});

describe("«Lo más pedido» en el menú público", () => {
  const popular = async () => (await req("GET", "/v1/public/merchants/pizzeria-don-pepe")).json().popularProductIds as string[];
  const onlyCoke = () => pickupBody({ items: [{ productId: cokeId, modifiers: [], quantity: 1 }] });
  const ageAllOrders = () =>
    ctx.db
      .update(orders)
      .set({ createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) })
      .where(eq(orders.merchantId, merchantId));

  // Los pedidos de los tests anteriores quedan fuera de la ventana: se arranca de cero.
  beforeAll(ageAllOrders);

  it("cuenta solo pedidos completados y pide al menos 3", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await placeOrder(onlyCoke());
      expect(res.statusCode).toBe(201);
      ids.push(res.json().order.id);
    }
    // Recibidos pero sin completar: todavía no cuentan.
    expect(await popular()).toEqual([]);
    await ctx.db.update(orders).set({ status: "PICKED_UP" }).where(eq(orders.id, ids[0]!));
    await ctx.db.update(orders).set({ status: "PICKED_UP" }).where(eq(orders.id, ids[1]!));
    expect(await popular()).toEqual([]);

    await ctx.db.update(orders).set({ status: "PICKED_UP" }).where(eq(orders.id, ids[2]!));
    expect(await popular()).toEqual([cokeId]);
  });

  it("los pedidos de hace más de 30 días no cuentan", async () => {
    await ageAllOrders();
    expect(await popular()).toEqual([]);
  });
});
