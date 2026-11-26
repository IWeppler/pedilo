import { createHmac, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { merchantMpAccounts, orders, payments, refunds } from "../src/db/schema";
import { createSecretBox } from "../src/lib/secret-box";
import { expireUnpaidOrders, UNPAID_ORDER_TTL_MS } from "../src/modules/orders/service";
import { GatewayError, type PaymentGateway, type ProviderPayment } from "../src/modules/payments/gateway";
import { type PaymentsContext, processRefunds } from "../src/modules/payments/service";
import { bearer, createTestContext, type TestContext } from "./helpers";

/** Mercado Pago falso: registra las llamadas y responde lo que diga cada test. */
function fakeGateway() {
  const calls = {
    create: [] as Array<{ token: string; amount: number; fee: number; key: string }>,
    refund: [] as Array<{ id: string; amount: number | null }>,
    refresh: 0,
  };
  const state = {
    nextStatus: "approved",
    refundError: null as GatewayError | null,
    payments: new Map<string, ProviderPayment>(),
    seq: 1000,
  };
  const gateway: PaymentGateway = {
    authorizationUrl: (s) => `https://auth.example/authorization?state=${s}`,
    exchangeCode: async (code) => {
      if (code === "bad") throw new GatewayError("invalid_grant", 400, true);
      return { accessToken: `seller-token-${code}`, refreshToken: `refresh-${code}`, userId: "777", expiresInSeconds: 180 * 86_400, liveMode: false, scope: "offline_access payments" };
    },
    refresh: async () => {
      calls.refresh++;
      return { accessToken: "seller-token-renewed", refreshToken: "refresh-renewed", userId: "777", expiresInSeconds: 180 * 86_400, liveMode: false, scope: null };
    },
    createPayment: async (token, input, key) => {
      calls.create.push({ token, amount: input.transactionAmount, fee: input.applicationFee, key });
      const p: ProviderPayment = {
        id: String(++state.seq),
        status: state.nextStatus,
        statusDetail: state.nextStatus === "approved" ? "accredited" : "cc_rejected_other_reason",
        externalReference: input.externalReference,
        transactionAmount: input.transactionAmount,
      };
      state.payments.set(p.id, p);
      return { ...p };
    },
    getPayment: async (_token, id) => ({ ...state.payments.get(id)! }),
    refund: async (_token, id, amount) => {
      if (state.refundError) throw state.refundError;
      calls.refund.push({ id, amount });
      return { id: `r-${id}-${calls.refund.length}`, status: "approved" };
    },
  };
  return { gateway, calls, state };
}

// Generado por corrida: nunca un secreto fijo en el repo.
const HOOK_KEY = randomBytes(16).toString("hex");
const fake = fakeGateway();
const box = createSecretBox(randomBytes(32).toString("base64"));
const paymentsCtx: PaymentsContext = { gateway: fake.gateway, box, publicKey: "public-key-de-prueba", notificationUrl: null };

let ctx: TestContext;
let admin: string;
let owner: string;
let merchantId: string;
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
const cardOrder = (paymentMethod = "MERCADO_PAGO") =>
  req("POST", "/v1/public/orders", {
    headers: { "idempotency-key": `pay-${++seq}-${Date.now()}` },
    payload: {
      merchantSlug: "kiosco-tarjeta",
      branchId,
      fulfillmentType: "PICKUP",
      paymentMethod,
      customer: { name: "Ana", phone: `3491 700-${String(seq).padStart(3, "0")}` },
      items: [{ productId, modifiers: [], quantity: 1 }],
    },
  });
const card = { token: "card-token-123", paymentMethodId: "master", payer: { email: "comprador@test.com", identification: { type: "DNI", number: "12345678" } } };
const pay = (orderId: string, token: string, key = `att-${++seq}-${Date.now()}`) =>
  req("POST", `/v1/public/orders/${orderId}/payments`, { headers: { "x-order-token": token, "idempotency-key": key }, payload: card });
const transition = (orderId: string, to: string, extra: Body = {}) =>
  req("POST", `/v1/merchants/${merchantId}/orders/${orderId}/transition`, { token: owner, payload: { to, ...extra } });

/** Pedido con tarjeta ya pagado. */
async function paidOrder() {
  fake.state.nextStatus = "approved";
  const { order, trackingToken } = (await cardOrder()).json() as { order: { id: string; totalMinor: number }; trackingToken: string };
  const res = await pay(order.id, trackingToken);
  expect(res.json()).toMatchObject({ status: "APPROVED", orderStatus: "PLACED" });
  return { orderId: order.id, token: trackingToken, totalMinor: order.totalMinor };
}

async function connect(code = "ok") {
  const { url } = (await req("POST", `/v1/merchants/${merchantId}/mercadopago/connect`, { token: owner })).json() as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  return { state, res: await req("GET", `/v1/payments/mercadopago/oauth/callback?code=${code}&state=${state}`) };
}

beforeAll(async () => {
  ctx = await createTestContext({}, { payments: { ctx: paymentsCtx, webhookSecret: HOOK_KEY, panelUrl: "http://panel.test" } });
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Kiosco", commissionCategory: "KIOSK" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Kiosco Tarjeta", legalName: "Ana López", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id;
  branchId = (
    await req("POST", `/v1/merchants/${merchantId}/branches`, { token: owner, payload: { name: "Centro", cityId, addressLine: "San Martín 1", acceptsPickup: true } })
  ).json().id;
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" }));
  await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: allDay } });
  await req("POST", `/v1/merchants/${merchantId}/submit`, { token: owner });
  await req("POST", `/v1/admin/merchants/${merchantId}/approve`, { token: admin });
  productId = (
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, { token: owner, payload: { name: "Combo", priceMinor: 1_000_000, variants: [], modifierGroups: [] } })
  ).json().id;
});
afterAll(async () => {
  await ctx.close();
});

describe("conexión del comercio (OAuth)", () => {
  it("sin conectar no se ofrece tarjeta y pedir con tarjeta da 409", async () => {
    expect((await req("GET", "/v1/public/merchants/kiosco-tarjeta")).json().merchant.payment.card).toBe(false);
    expect((await cardOrder()).json().error.details.reason).toBe("PAYMENT_METHOD_NOT_AVAILABLE");
    expect((await req("GET", "/v1/payments/config")).json()).toEqual({ enabled: true, publicKey: "public-key-de-prueba" });
  });

  it("solo el dueño conecta; el state es de un solo uso; los tokens quedan cifrados", async () => {
    const stranger = (await ctx.tokenFor()).token;
    expect((await req("POST", `/v1/merchants/${merchantId}/mercadopago/connect`, { token: stranger })).statusCode).not.toBe(200);

    const failed = await connect("bad");
    expect(failed.res.headers.location).toBe(`http://panel.test/m/${merchantId}/profile?mp=error`);

    const { state, res } = await connect("ok");
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`http://panel.test/m/${merchantId}/profile?mp=connected`);
    // Reusar el state no vuelve a conectar.
    expect((await req("GET", `/v1/payments/mercadopago/oauth/callback?code=otro&state=${state}`)).headers.location).toBe("http://panel.test/?mp=error");

    const [row] = await ctx.db.select().from(merchantMpAccounts).where(eq(merchantMpAccounts.merchantId, merchantId));
    expect(row!.accessTokenEnc).not.toContain("seller-token");
    expect(box.open(row!.accessTokenEnc)).toBe("seller-token-ok");

    const status = (await req("GET", `/v1/merchants/${merchantId}/mercadopago`, { token: owner })).json();
    expect(status).toMatchObject({ connected: true, mpUserId: "777", liveMode: false, available: true });
    expect(JSON.stringify(status)).not.toContain("token");
    expect((await req("GET", "/v1/public/merchants/kiosco-tarjeta")).json().merchant.payment.card).toBe(true);
  });
});

describe("cobro con split", () => {
  it("el pedido espera el pago; aprobado pasa al comercio con la comisión como application_fee", async () => {
    const created = (await cardOrder()).json() as { order: { id: string; status: string; totalMinor: number }; trackingToken: string };
    expect(created.order.status).toBe("PENDING_PAYMENT");
    const pulse = (await req("GET", `/v1/merchants/${merchantId}/orders/pulse`, { token: owner })).json();
    expect(JSON.stringify(pulse)).not.toContain(created.order.id);

    fake.state.nextStatus = "approved";
    const key = `att-fixed-${Date.now()}`;
    const res = await pay(created.order.id, created.trackingToken, key);
    expect(res.json()).toMatchObject({ status: "APPROVED", providerStatus: "approved", orderStatus: "PLACED" });
    // $10.000 · Emprendedor 6% → $600 de comisión retenida por Mercado Pago.
    expect(fake.calls.create.at(-1)).toMatchObject({ token: "seller-token-ok", amount: 10_000, fee: 600, key });

    // Mismo Idempotency-Key: no se cobra dos veces.
    const before = fake.calls.create.length;
    expect((await pay(created.order.id, created.trackingToken, key)).json().status).toBe("APPROVED");
    expect(fake.calls.create.length).toBe(before);
    // Otro intento con el pedido ya pagado: 409.
    expect((await pay(created.order.id, created.trackingToken)).json().error.details.reason).toBe("NOT_PAYABLE");
    // Con otro token de seguimiento no se paga.
    expect((await pay(created.order.id, "token-equivocado-123")).statusCode).toBe(404);

    const [order] = await ctx.db.select().from(orders).where(eq(orders.id, created.order.id));
    expect(order).toMatchObject({ paymentStatus: "APPROVED" });
    expect(order!.acceptDeadlineAt).not.toBeNull();
  });

  it("un rechazo deja reintentar con otra tarjeta", async () => {
    const { order, trackingToken } = (await cardOrder()).json() as { order: { id: string }; trackingToken: string };
    fake.state.nextStatus = "rejected";
    expect((await pay(order.id, trackingToken)).json()).toMatchObject({ status: "REJECTED", orderStatus: "PENDING_PAYMENT" });
    fake.state.nextStatus = "approved";
    expect((await pay(order.id, trackingToken)).json()).toMatchObject({ status: "APPROVED", orderStatus: "PLACED" });
  });

  it("en proceso: se confirma consultando el estado (los pagos de prueba no mandan webhooks)", async () => {
    const { order, trackingToken } = (await cardOrder()).json() as { order: { id: string }; trackingToken: string };
    fake.state.nextStatus = "in_process";
    expect((await pay(order.id, trackingToken)).json()).toMatchObject({ status: "PENDING", orderStatus: "PENDING_PAYMENT" });
    expect((await pay(order.id, trackingToken)).json().error.details.reason).toBe("PAYMENT_IN_PROGRESS");
    const [row] = await ctx.db.select().from(payments).where(eq(payments.orderId, order.id));
    fake.state.payments.get(row!.providerPaymentId!)!.status = "approved";
    const status = await req("GET", `/v1/public/orders/${order.id}/payment`, { headers: { "x-order-token": trackingToken } });
    expect(status.json().payment).toMatchObject({ status: "APPROVED", orderStatus: "PLACED" });
  });

  it("con tarjeta la comisión no es deuda del comercio", async () => {
    const before = (await req("GET", `/v1/merchants/${merchantId}/billing`, { token: owner })).json().balanceMinor as number;
    const o = await paidOrder();
    for (const to of ["ACCEPTED", "PREPARING", "READY", "PICKED_UP"]) await transition(o.orderId, to);
    expect((await req("GET", `/v1/merchants/${merchantId}/billing`, { token: owner })).json().balanceMinor).toBe(before);
  });

  it("sin pagar a los 30 minutos, el pedido vence", async () => {
    const { order } = (await cardOrder()).json() as { order: { id: string } };
    expect(await expireUnpaidOrders(ctx.db, new Date(Date.now() + UNPAID_ORDER_TTL_MS + 1000))).toBeGreaterThanOrEqual(1);
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
    expect(row).toMatchObject({ status: "EXPIRED", paymentStatus: "CANCELLED" });
  });
});

describe("webhook", () => {
  const sign = (dataId: string, requestId: string, ts = Math.floor(Date.now() / 1000)) =>
    `ts=${ts},v1=${createHmac("sha256", HOOK_KEY).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex")}`;

  it("firma inválida → 401; válida → consulta el pago y lo aplica, una sola vez", async () => {
    const { order, trackingToken } = (await cardOrder()).json() as { order: { id: string }; trackingToken: string };
    fake.state.nextStatus = "in_process";
    await pay(order.id, trackingToken);
    const [row] = await ctx.db.select().from(payments).where(eq(payments.orderId, order.id));
    const dataId = row!.providerPaymentId!;
    const url = `/v1/webhooks/mercadopago?data.id=${dataId}&type=payment`;
    const payload = { type: "payment", action: "payment.updated", data: { id: dataId }, user_id: 777 };

    expect((await req("POST", url, { payload, headers: { "x-request-id": "req-1", "x-signature": sign(dataId, "otro-request") } })).statusCode).toBe(401);
    expect((await req("POST", url, { payload, headers: { "x-request-id": "req-1" } })).statusCode).toBe(401);

    fake.state.payments.get(dataId)!.status = "approved";
    expect((await req("POST", url, { payload, headers: { "x-request-id": "req-1", "x-signature": sign(dataId, "req-1") } })).statusCode).toBe(200);
    const [after] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));
    expect(after).toMatchObject({ status: "PLACED", paymentStatus: "APPROVED" });
    // Reintento del mismo aviso: 200 y sin efectos.
    expect((await req("POST", url, { payload, headers: { "x-request-id": "req-1", "x-signature": sign(dataId, "req-1") } })).statusCode).toBe(200);
  });
});

describe("reembolsos", () => {
  it("el comercio rechaza un pedido pagado → devolución total confirmada por el proveedor", async () => {
    const o = await paidOrder();
    expect((await transition(o.orderId, "REJECTED", { reason: "Nos quedamos sin stock" })).statusCode).toBe(200);
    let [row] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
    expect(row!.paymentStatus).toBe("REFUND_PENDING");

    expect(await processRefunds(ctx.db, paymentsCtx)).toBeGreaterThanOrEqual(1);
    expect(fake.calls.refund.at(-1)).toMatchObject({ amount: null });
    [row] = await ctx.db.select().from(orders).where(eq(orders.id, o.orderId));
    expect(row!.paymentStatus).toBe("REFUNDED");
  });

  async function agreedClaim(amountMinor: number) {
    const o = await paidOrder();
    for (const to of ["ACCEPTED", "PREPARING", "READY", "PICKED_UP"]) await transition(o.orderId, to);
    const claimId = (
      await req("POST", `/v1/public/orders/${o.orderId}/claim`, {
        headers: { "x-order-token": o.token },
        payload: { reason: "MISSING_ITEM", description: "Faltó una gaseosa" },
      })
    ).json().id as string;
    await req("POST", `/v1/merchants/${merchantId}/claims/${claimId}/propose`, { token: owner, payload: { type: "REFUND_PARTIAL", amountMinor } });
    await req("POST", `/v1/public/orders/${o.orderId}/claim/respond`, { headers: { "x-order-token": o.token }, payload: { accept: true } });
    const res = await req("POST", `/v1/merchants/${merchantId}/claims/${claimId}/refunded`, { token: owner, payload: {} });
    return { ...o, claimId, res };
  }
  const claimOf = async (orderId: string, token: string) =>
    (await req("GET", `/v1/public/orders/${orderId}/claim`, { headers: { "x-order-token": token } })).json().claim;

  it("reclamo con devolución parcial: queda en proceso hasta que Mercado Pago confirma", async () => {
    const c = await agreedClaim(300_000);
    expect(c.res.json().status).toBe("PAYMENT_REFUND_PENDING");
    await processRefunds(ctx.db, paymentsCtx);
    expect(fake.calls.refund.at(-1)).toMatchObject({ amount: 3_000 });
    expect(await claimOf(c.orderId, c.token)).toMatchObject({ status: "RESOLVED", refundedMinor: 300_000 });
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, c.orderId));
    expect(row!.paymentStatus).toBe("PARTIALLY_REFUNDED");
  });

  it("si Mercado Pago rechaza la devolución, no hay éxito falso: el reclamo va a Pedilo", async () => {
    const c = await agreedClaim(200_000);
    fake.state.refundError = new GatewayError("insufficient_amount", 400, true);
    await processRefunds(ctx.db, paymentsCtx);
    fake.state.refundError = null;
    expect((await claimOf(c.orderId, c.token)).status).toBe("ESCALATED");
    const [refund] = await ctx.db.select().from(refunds).where(eq(refunds.claimId, c.claimId));
    expect(refund).toMatchObject({ status: "FAILED" });
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, c.orderId));
    expect(row!.paymentStatus).toBe("REFUND_BLOCKED");
  });

  it("error transitorio: se reintenta más tarde", async () => {
    const o = await paidOrder();
    await transition(o.orderId, "REJECTED", { reason: "Cerramos temprano" });
    fake.state.refundError = new GatewayError("timeout", null, false);
    const now = new Date();
    await processRefunds(ctx.db, paymentsCtx, now);
    fake.state.refundError = null;
    const [pending] = await ctx.db.select().from(refunds).where(eq(refunds.orderId, o.orderId));
    expect(pending).toMatchObject({ status: "PENDING", attempts: 1 });
    await processRefunds(ctx.db, paymentsCtx, new Date(now.getTime() + 10 * 60_000));
    const [done] = await ctx.db.select().from(refunds).where(eq(refunds.orderId, o.orderId));
    expect(done).toMatchObject({ status: "APPROVED" });
  });
});

describe("token del comercio", () => {
  it("se renueva cuando está por vencer y se guardan los dos tokens nuevos", async () => {
    await ctx.db.update(merchantMpAccounts).set({ expiresAt: new Date(Date.now() + 86_400_000) }).where(eq(merchantMpAccounts.merchantId, merchantId));
    await paidOrder();
    expect(fake.calls.refresh).toBe(1);
    expect(fake.calls.create.at(-1)!.token).toBe("seller-token-renewed");
    const [row] = await ctx.db.select().from(merchantMpAccounts).where(eq(merchantMpAccounts.merchantId, merchantId));
    expect(box.open(row!.refreshTokenEnc)).toBe("refresh-renewed");
  });

  it("desconectar deja de ofrecer tarjeta", async () => {
    expect((await req("DELETE", `/v1/merchants/${merchantId}/mercadopago`, { token: owner })).json().connected).toBe(false);
    expect((await req("GET", "/v1/public/merchants/kiosco-tarjeta")).json().merchant.payment.card).toBe(false);
  });
});
