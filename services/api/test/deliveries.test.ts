import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deliveryEvents } from "../src/db/schema";
import { expireOffers } from "../src/modules/deliveries/service";
import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: string;
let owner: string;
let c1: string; // repartidores aprobados y disponibles
let c2: string;
let pending: string; // registrado, sin aprobar
let merchantId: string;
let branchId: string;
let zoneId: string;
let cityId: string;
let productId: string;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

let seq = 0;
const DROPOFF = "Belgrano 456";
const placeOrder = async (fulfillment: "DELIVERY" | "PICKUP" = "DELIVERY") => {
  const res = await req("POST", "/v1/public/orders", {
    headers: { "idempotency-key": `delivery-${++seq}-${Date.now()}` },
    payload: {
      merchantSlug: "pizzeria-centro",
      branchId,
      fulfillmentType: fulfillment,
      ...(fulfillment === "DELIVERY" && { deliveryZoneId: zoneId, deliveryAddress: { line: DROPOFF, notes: "Timbre B" } }),
      customer: { name: "Ana", phone: `3491 700-${String(seq).padStart(3, "0")}` },
      items: [{ productId, modifiers: [], quantity: 2 }],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().order as { id: string; totalMinor: number };
};
const transition = (orderId: string, to: string, reason?: string) =>
  req("POST", `/v1/merchants/${merchantId}/orders/${orderId}/transition`, { token: owner, payload: { to, ...(reason && { reason }) } });
const requestCourier = (orderId: string, payload?: Body) =>
  req("POST", `/v1/merchants/${merchantId}/orders/${orderId}/delivery`, { token: owner, ...(payload && { payload }) });
const orderStatus = async (orderId: string) => {
  for (const scope of ["active", "done"]) {
    const list = (await req("GET", `/v1/merchants/${merchantId}/orders?scope=${scope}`, { token: owner })).json() as Array<{
      id: string;
      status: string;
      dispatch: { status: string } | null;
      statusReason: string | null;
    }>;
    const found = list.find((o) => o.id === orderId);
    if (found) return found;
  }
  throw new Error("pedido no encontrado");
};
const offers = (token: string) => req("GET", "/v1/courier/offers", { token });
const accept = (token: string, deliveryId: string) => req("POST", `/v1/courier/offers/${deliveryId}/accept`, { token });
const courierStatus = (token: string, deliveryId: string, to: string, eventId = `ev-${++seq}-${Date.now()}`, reason?: string) =>
  req("POST", `/v1/courier/deliveries/${deliveryId}/status`, { token, payload: { to, eventId, ...(reason && { reason }) } });

/** Pedido con envío aceptado y con la oferta publicada. Devuelve ids. */
const offeredOrder = async (payload?: Body) => {
  const order = await placeOrder();
  await transition(order.id, "ACCEPTED");
  const res = await requestCourier(order.id, payload);
  expect(res.statusCode).toBe(201);
  return { orderId: order.id, deliveryId: res.json().dispatch.id as string, totalMinor: order.totalMinor };
};

const registerCourier = (token: string, over: Body = {}) =>
  req("POST", "/v1/courier/profile", {
    token,
    payload: { displayName: "Juan", phone: "3491 555-000", vehicle: "MOTO", cityId, ...over },
  });

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  [c1, c2, pending] = await Promise.all([ctx.tokenFor(), ctx.tokenFor(), ctx.tokenFor()]).then((u) => u.map((x) => x.token));

  cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Pizzería Centro", legalName: "José Pérez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id;
  branchId = (
    await req("POST", `/v1/merchants/${merchantId}/branches`, {
      token: owner,
      payload: { name: "Centro", cityId, addressLine: "San Martín 123", phone: "3491 111222", acceptsPickup: true, acceptsDelivery: true },
    })
  ).json().id;
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" }));
  await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: allDay } });
  zoneId = (
    await req("POST", `/v1/merchants/${merchantId}/branches/${branchId}/zones`, { token: owner, payload: { name: "Barrio Norte", feeMinor: 150000 } })
  ).json().id;
  await req("POST", `/v1/merchants/${merchantId}/submit`, { token: owner });
  await req("POST", `/v1/admin/merchants/${merchantId}/approve`, { token: admin });
  productId = (
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, {
      token: owner,
      payload: { name: "Muzzarella", priceMinor: 900000, variants: [], modifierGroups: [] },
    })
  ).json().id;
});
afterAll(() => ctx.close());

describe("repartidores: registro y moderación", () => {
  it("se registra en revisión; sin aprobar no puede ponerse disponible", async () => {
    const res = await registerCourier(pending);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "PENDING_REVIEW", available: false });
    expect((await registerCourier(pending)).statusCode).toBe(409);
    expect((await req("PATCH", "/v1/courier/me", { token: pending, payload: { available: true } })).statusCode).toBe(403);
    expect((await offers(pending)).statusCode).toBe(403);
  });

  it("el admin aprueba (o rechaza con motivo); aprobado se pone disponible", async () => {
    for (const token of [c1, c2]) {
      const id = (await registerCourier(token)).json().id;
      expect((await req("POST", `/v1/admin/couriers/${id}/review`, { token: admin, payload: { status: "REJECTED" } })).statusCode).toBe(400);
      expect((await req("POST", `/v1/admin/couriers/${id}/review`, { token: owner, payload: { status: "APPROVED" } })).statusCode).toBe(403);
      const ok = await req("POST", `/v1/admin/couriers/${id}/review`, { token: admin, payload: { status: "APPROVED" } });
      expect(ok.json().status).toBe("APPROVED");
      expect((await req("PATCH", "/v1/courier/me", { token, payload: { available: true } })).json().available).toBe(true);
    }
    const listed = (await req("GET", "/v1/admin/couriers?status=PENDING_REVIEW", { token: admin })).json();
    expect(listed).toHaveLength(1);
  });
});

describe("pedir repartidor y ofertas", () => {
  it("solo pedidos con envío, aceptados y antes de que salgan; uno por pedido", async () => {
    const pickup = await placeOrder("PICKUP");
    await transition(pickup.id, "ACCEPTED");
    expect((await requestCourier(pickup.id)).json().error.details.reason).toBe("NOT_DELIVERY");

    const order = await placeOrder();
    expect((await requestCourier(order.id)).json().error.details.reason).toBe("INVALID_STATUS");
    await transition(order.id, "ACCEPTED");
    const res = await requestCourier(order.id);
    expect(res.statusCode).toBe(201);
    expect(res.json().dispatch).toMatchObject({
      status: "OFFERED",
      courierFeeMinor: 150000, // sugerida: el envío que pagó el cliente
      cashToCollectMinor: order.totalMinor, // efectivo sin cobrar: lo cobra el repartidor
      pickup: { name: "Pizzería Centro", address: "San Martín 123", phone: "3491 111222" },
      dropoff: { area: "Barrio Norte", address: DROPOFF },
      packageDescription: "2 × Muzzarella",
    });
    expect((await requestCourier(order.id)).json().error.details.reason).toBe("DELIVERY_EXISTS");
  });

  it("la oferta no muestra la dirección ni el destinatario; respeta la tarifa mínima", async () => {
    const { deliveryId } = await offeredOrder();
    const list = (await offers(c1)).json() as Array<{ id: string }>;
    const mine = list.find((o) => o.id === deliveryId);
    expect(mine).toMatchObject({ dropoffArea: "Barrio Norte", courierFeeMinor: 150000 });
    expect(JSON.stringify(list)).not.toContain(DROPOFF);
    expect(JSON.stringify(list)).not.toContain("Ana");

    await req("PATCH", "/v1/courier/me", { token: c2, payload: { minFeeMinor: 200000 } });
    expect((await offers(c2)).json().map((o: { id: string }) => o.id)).not.toContain(deliveryId);
    await req("PATCH", "/v1/courier/me", { token: c2, payload: { minFeeMinor: 0, available: false } });
    expect((await offers(c2)).json()).toEqual([]);
    await req("PATCH", "/v1/courier/me", { token: c2, payload: { available: true } });
  });

  it("rechazar no penaliza: deja de verla; si el comercio sube la tarifa, la vuelve a ver", async () => {
    const { deliveryId } = await offeredOrder();
    expect((await req("POST", `/v1/courier/offers/${deliveryId}/decline`, { token: c1 })).statusCode).toBe(204);
    expect((await offers(c1)).json().map((o: { id: string }) => o.id)).not.toContain(deliveryId);
    const re = await req("POST", `/v1/merchants/${merchantId}/deliveries/${deliveryId}/reoffer`, { token: owner, payload: { feeMinor: 180000 } });
    expect(re.json()).toMatchObject({ status: "OFFERED", courierFeeMinor: 180000 });
    expect((await offers(c1)).json().map((o: { id: string }) => o.id)).toContain(deliveryId);
  });
});

describe("G2: aceptación atómica, estados y reconexión", () => {
  let orderId: string;
  let deliveryId: string;
  let winner: string;

  it("dos repartidores aceptan a la vez: gana uno solo", async () => {
    ({ orderId, deliveryId } = await offeredOrder());
    const [a, b] = await Promise.all([accept(c1, deliveryId), accept(c2, deliveryId)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const lost = a.statusCode === 409 ? a : b;
    expect(lost.json().error.details.reason).toBe("OFFER_TAKEN");
    winner = a.statusCode === 200 ? c1 : c2;
    const loser = winner === c1 ? c2 : c1;

    // El ganador ve el destino completo; el otro no lo ve ni lo puede tocar.
    const active = (await req("GET", "/v1/courier/deliveries", { token: winner })).json();
    expect(active[0]).toMatchObject({ id: deliveryId, status: "ASSIGNED", dropoff: { address: DROPOFF }, recipient: { name: "Ana" } });
    expect((await req("GET", "/v1/courier/deliveries", { token: loser })).json()).toEqual([]);
    expect((await courierStatus(loser, deliveryId, "PICKED_UP")).statusCode).toBe(404);
    expect((await offers(loser)).json().map((o: { id: string }) => o.id)).not.toContain(deliveryId);

    // El comercio ve quién lo lleva; el pedido no cambió de estado.
    expect(await orderStatus(orderId)).toMatchObject({ status: "ACCEPTED", dispatch: { status: "ASSIGNED" } });
  });

  it("con repartidor asignado, el comercio no marca el envío a mano", async () => {
    expect((await transition(orderId, "PREPARING")).statusCode).toBe(200); // preparar/listo sí
    expect((await transition(orderId, "READY")).statusCode).toBe(200);
    expect((await transition(orderId, "PICKED_UP_BY_COURIER")).json().error.details.reason).toBe("DELIVERY_IN_PROGRESS");
  });

  it("retirado → el pedido sale; la misma acción repetida (reintento sin señal) no duplica", async () => {
    const eventId = `retry-${Date.now()}`;
    const first = await courierStatus(winner, deliveryId, "PICKED_UP", eventId);
    expect(first.json()).toMatchObject({ status: "PICKED_UP", pickedUpAt: expect.any(String) });
    const again = await courierStatus(winner, deliveryId, "PICKED_UP", eventId);
    expect(again.statusCode).toBe(200);
    const events = await ctx.db.select().from(deliveryEvents).where(eq(deliveryEvents.deliveryId, deliveryId));
    expect(events.filter((e) => e.toStatus === "PICKED_UP")).toHaveLength(1);
    expect((await orderStatus(orderId)).status).toBe("PICKED_UP_BY_COURIER");

    // Acción inválida en este estado.
    expect((await courierStatus(winner, deliveryId, "ARRIVING_PICKUP")).json().error.details.reason).toBe("INVALID_TRANSITION");
  });

  it("entregado → pedido entregado; queda en el historial del repartidor", async () => {
    expect((await courierStatus(winner, deliveryId, "DELIVERED")).json().status).toBe("DELIVERED");
    expect((await orderStatus(orderId)).status).toBe("DELIVERED");
    expect((await req("GET", "/v1/courier/deliveries", { token: winner })).json()).toEqual([]);
    const done = (await req("GET", "/v1/courier/deliveries?scope=done", { token: winner })).json();
    expect(done.map((d: { id: string }) => d.id)).toContain(deliveryId);
  });

  it("no se pudo entregar: exige motivo y el pedido queda fallido con ese motivo", async () => {
    const o = await offeredOrder();
    await accept(c1, o.deliveryId);
    await courierStatus(c1, o.deliveryId, "PICKED_UP");
    expect((await courierStatus(c1, o.deliveryId, "DELIVERY_FAILED")).statusCode).toBe(400);
    await courierStatus(c1, o.deliveryId, "DELIVERY_FAILED", undefined, "No atendía nadie");
    expect(await orderStatus(o.orderId)).toMatchObject({ status: "DELIVERY_FAILED", statusReason: "No atendía nadie" });
  });
});

describe("vencimiento, cancelaciones y reasignación", () => {
  it("la oferta vence por hora del servidor; el comercio la vuelve a ofertar", async () => {
    const { deliveryId } = await offeredOrder({ offerMinutes: 2 });
    expect(await expireOffers(ctx.db, new Date(Date.now() + 3 * 60_000))).toBeGreaterThanOrEqual(1);
    const res = await accept(c1, deliveryId);
    expect(res.json().error.details.reason).toBe("OFFER_EXPIRED");
    const re = await req("POST", `/v1/merchants/${merchantId}/deliveries/${deliveryId}/reoffer`, { token: owner, payload: { feeMinor: 200000 } });
    expect(re.json().status).toBe("OFFERED");
    expect((await accept(c1, deliveryId)).statusCode).toBe(200);
  });

  it("el repartidor cancela antes de retirar (con motivo): deja de ser suyo y se reasigna", async () => {
    const { orderId, deliveryId } = await offeredOrder();
    await accept(c2, deliveryId);
    expect((await courierStatus(c2, deliveryId, "COURIER_CANCELLED")).statusCode).toBe(400);
    const res = await courierStatus(c2, deliveryId, "COURIER_CANCELLED", undefined, "Se me pinchó la rueda");
    expect(res.json()).toMatchObject({ status: "COURIER_CANCELLED", courier: null });
    expect((await req("GET", "/v1/courier/deliveries", { token: c2 })).json().map((d: { id: string }) => d.id)).not.toContain(deliveryId);
    expect((await orderStatus(orderId)).dispatch?.status).toBe("COURIER_CANCELLED");

    await req("POST", `/v1/merchants/${merchantId}/deliveries/${deliveryId}/reoffer`, { token: owner, payload: { feeMinor: 160000 } });
    expect((await accept(c1, deliveryId)).json()).toMatchObject({ status: "ASSIGNED", courier: { name: "Juan" } });
  });

  it("cancelar el pedido cancela el reparto; con el paquete retirado el comercio no lo cancela", async () => {
    const a = await offeredOrder();
    await accept(c1, a.deliveryId);
    await transition(a.orderId, "CANCELLED", "Sin stock");
    const deliveries = (await req("GET", `/v1/merchants/${merchantId}/deliveries`, { token: owner })).json() as Array<{ id: string; status: string }>;
    expect(deliveries.find((d) => d.id === a.deliveryId)!.status).toBe("CANCELLED");
    expect((await req("GET", "/v1/courier/deliveries", { token: c1 })).json().map((d: { id: string }) => d.id)).not.toContain(a.deliveryId);

    const b = await offeredOrder();
    await accept(c1, b.deliveryId);
    await courierStatus(c1, b.deliveryId, "PICKED_UP");
    const cancel = await req("POST", `/v1/merchants/${merchantId}/deliveries/${b.deliveryId}/cancel`, { token: owner, payload: { reason: "Me arrepentí" } });
    expect(cancel.json().error.details.reason).toBe("ALREADY_PICKED_UP");
  });

  it("el comercio cancela la búsqueda y lo manda por su cuenta", async () => {
    const { orderId, deliveryId } = await offeredOrder();
    await transition(orderId, "PREPARING");
    await transition(orderId, "READY");
    expect((await transition(orderId, "PICKED_UP_BY_COURIER")).json().error.details.reason).toBe("DELIVERY_IN_PROGRESS");
    const res = await req("POST", `/v1/merchants/${merchantId}/deliveries/${deliveryId}/cancel`, { token: owner, payload: { reason: "Lo llevo yo" } });
    expect(res.json().status).toBe("CANCELLED");
    expect((await transition(orderId, "PICKED_UP_BY_COURIER")).statusCode).toBe(200);
  });
});
