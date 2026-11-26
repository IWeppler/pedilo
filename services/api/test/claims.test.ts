import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { customerPushTokens, notificationOutbox } from "../src/db/schema";
import { escalateOverdueClaims, openClaim } from "../src/modules/claims/service";
import { type CustomerPushSender, processOutbox } from "../src/modules/notifications/service";
import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let dir: string;
let admin: string;
let owner: string;
let stranger: string;
let merchantId: string;
let branchId: string;
let productId: string;
const SECRET = "test-order-token-secret";

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

let seq = 0;
/** Pedido de retiro de $10.000 ya retirado (completo). Devuelve id y token del cliente. */
async function completedOrder(complete = true) {
  const res = await req("POST", "/v1/public/orders", {
    headers: { "idempotency-key": `claim-${++seq}-${Date.now()}` },
    payload: {
      merchantSlug: "almacen-reclamos",
      branchId,
      fulfillmentType: "PICKUP",
      customer: { name: "Ana", phone: `3491 800-${String(seq).padStart(3, "0")}` },
      items: [{ productId, modifiers: [], quantity: 1 }],
    },
  });
  const { order, trackingToken } = res.json() as { order: { id: string; totalMinor: number }; trackingToken: string };
  if (complete) {
    for (const to of ["ACCEPTED", "PREPARING", "READY", "PICKED_UP"]) {
      await req("POST", `/v1/merchants/${merchantId}/orders/${order.id}/transition`, { token: owner, payload: { to } });
    }
  }
  return { orderId: order.id, token: trackingToken, totalMinor: order.totalMinor };
}

const customer = (orderId: string, token: string) => ({
  open: (payload: Body) => req("POST", `/v1/public/orders/${orderId}/claim`, { headers: { "x-order-token": token }, payload }),
  get: () => req("GET", `/v1/public/orders/${orderId}/claim`, { headers: { "x-order-token": token } }),
  respond: (accept: boolean, comment?: string) =>
    req("POST", `/v1/public/orders/${orderId}/claim/respond`, { headers: { "x-order-token": token }, payload: { accept, ...(comment && { comment }) } }),
  escalate: (comment: string) => req("POST", `/v1/public/orders/${orderId}/claim/escalate`, { headers: { "x-order-token": token }, payload: { comment } }),
});
const merchantPost = (claimId: string, action: string, payload: Body, token = owner) =>
  req("POST", `/v1/merchants/${merchantId}/claims/${claimId}/${action}`, { token, payload });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pedilo-claims-"));
  ctx = await createTestContext({ media: { driver: "local", dir } });
  admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  stranger = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Almacén", commissionCategory: "KIOSK" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Almacén Reclamos", legalName: "Ana López", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
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
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, { token: owner, payload: { name: "Canasta", priceMinor: 1_000_000, variants: [], modifierGroups: [] } })
  ).json().id;
});
afterAll(async () => {
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
});

describe("abrir un reclamo", () => {
  it("solo con el pedido terminado, con el token correcto y uno por pedido", async () => {
    const pending = await completedOrder(false);
    expect((await customer(pending.orderId, pending.token).open({ reason: "MISSING_ITEM", description: "Faltó una botella de aceite" })).json().error.details.reason).toBe("NOT_CLAIMABLE");

    const o = await completedOrder();
    expect((await customer(o.orderId, "token-equivocado-123").open({ reason: "MISSING_ITEM", description: "Faltó una botella" })).statusCode).toBe(404);
    const res = await customer(o.orderId, o.token).open({ reason: "MISSING_ITEM", description: "Faltó una botella de aceite" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "OPEN", reason: "MISSING_ITEM", sensitive: false, orderTotalMinor: 1_000_000 });
    expect((await customer(o.orderId, o.token).open({ reason: "QUALITY", description: "Otro reclamo más" })).json().error.details.reason).toBe("CLAIM_EXISTS");
    expect((await customer(o.orderId, o.token).get()).json().claim.events[0]).toMatchObject({ actor: "CUSTOMER", kind: "OPENED" });
  });

  it("no después de 48 h", async () => {
    const o = await completedOrder();
    const later = new Date(Date.now() + 49 * 3_600_000);
    await expect(
      openClaim(ctx.db, o.orderId, o.token, SECRET, { reason: "QUALITY", description: "Estaba vencido" }, later),
    ).rejects.toMatchObject({ details: { reason: "CLAIM_WINDOW_CLOSED" } });
  });
});

describe("el comercio propone, el cliente responde", () => {
  it("disputa, nueva propuesta, devolución parcial y corrección de la comisión", async () => {
    const o = await completedOrder();
    const claimId = (await customer(o.orderId, o.token).open({ reason: "MISSING_ITEM", description: "Faltaron dos productos" })).json().id;

    expect((await req("GET", `/v1/merchants/${merchantId}/claims`, { token: owner })).json().map((c: { id: string }) => c.id)).toContain(claimId);
    expect((await req("GET", `/v1/merchants/${merchantId}/claims/${claimId}`, { token: stranger })).statusCode).not.toBe(200);

    // Validaciones de la propuesta.
    expect((await merchantPost(claimId, "propose", { type: "REJECT" })).statusCode).toBe(400);
    expect((await merchantPost(claimId, "propose", { type: "REFUND_PARTIAL", amountMinor: o.totalMinor })).statusCode).toBe(400);

    // Primera propuesta: reenvío. El cliente la rechaza → en desacuerdo.
    expect((await merchantPost(claimId, "propose", { type: "RESEND", note: "Te lo llevamos mañana" })).json().status).toBe("MERCHANT_REVIEW");
    expect((await customer(o.orderId, o.token).respond(false, "Prefiero la plata")).json().status).toBe("DISPUTED");

    // Nueva propuesta: devolución parcial de $4.000. El cliente acepta.
    const proposal = await merchantPost(claimId, "propose", { type: "REFUND_PARTIAL", amountMinor: 400_000, note: "Devolvemos lo que faltó" });
    expect(proposal.json()).toMatchObject({ status: "MERCHANT_REVIEW", proposal: { type: "REFUND_PARTIAL", amountMinor: 400_000 } });
    expect((await customer(o.orderId, o.token).respond(true)).json().status).toBe("AGREED_REFUND");

    // El comercio registra la devolución: resuelto y la comisión se corrige.
    const before = (await req("GET", `/v1/merchants/${merchantId}/billing`, { token: owner })).json().balanceMinor as number;
    const done = await merchantPost(claimId, "refunded", { note: "Transferido" });
    expect(done.json()).toMatchObject({ status: "RESOLVED", refundedMinor: 400_000 });
    const billing = (await req("GET", `/v1/merchants/${merchantId}/billing`, { token: owner })).json();
    // Emprendedor 6% · tope kiosco $4.000: $10.000 → $600; base $6.000 → $360. Ajuste: −$240.
    expect(billing.balanceMinor).toBe(before - 24_000);
    expect(billing.entries[0]).toMatchObject({ kind: "ADJUSTMENT", amountMinor: -24_000, orderId: o.orderId });

    expect((await merchantPost(claimId, "refunded", {})).statusCode).toBe(409);
    const kinds = (await customer(o.orderId, o.token).get()).json().claim.events.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(["OPENED", "PROPOSAL", "REJECTED", "PROPOSAL", "ACCEPTED", "REFUNDED"]);
  });

  it("aceptar un reemplazo lo resuelve sin devolución", async () => {
    const o = await completedOrder();
    const claimId = (await customer(o.orderId, o.token).open({ reason: "WRONG_ITEM", description: "Vino otra marca" })).json().id;
    await merchantPost(claimId, "propose", { type: "REPLACE", note: "Pasá a cambiarlo" });
    expect((await customer(o.orderId, o.token).respond(true)).json()).toMatchObject({ status: "RESOLVED", refundedMinor: null });
  });
});

describe("Pedilo interviene", () => {
  it("sin respuesta del comercio en 24 h se escala; el admin lo resuelve con nota", async () => {
    const o = await completedOrder();
    const claimId = (await customer(o.orderId, o.token).open({ reason: "QUALITY", description: "El pan estaba duro" })).json().id;
    expect(await escalateOverdueClaims(ctx.db, new Date(Date.now() + 25 * 3_600_000))).toBeGreaterThanOrEqual(1);
    expect((await customer(o.orderId, o.token).get()).json().claim.status).toBe("ESCALATED");

    expect((await req("GET", "/v1/admin/claims?status=ESCALATED", { token: admin })).json().map((c: { id: string }) => c.id)).toContain(claimId);
    expect((await req("POST", `/v1/admin/claims/${claimId}/resolve`, { token: owner, payload: { to: "RESOLVED", note: "Ok ok ok" } })).statusCode).toBe(403);
    const resolved = await req("POST", `/v1/admin/claims/${claimId}/resolve`, { token: admin, payload: { to: "RESOLVED", note: "Hablamos con el comercio: te reponen el pan." } });
    expect(resolved.json()).toMatchObject({ status: "RESOLVED", resolutionNote: "Hablamos con el comercio: te reponen el pan." });
  });

  it("el cliente escala una disputa", async () => {
    const o = await completedOrder();
    const claimId = (await customer(o.orderId, o.token).open({ reason: "WRONG_CHARGE", description: "Me cobraron de más" })).json().id;
    await merchantPost(claimId, "propose", { type: "REJECT", note: "El precio era el del menú" });
    await customer(o.orderId, o.token).respond(false);
    expect((await customer(o.orderId, o.token).escalate("El menú decía otro precio")).json().status).toBe("ESCALATED");
  });

  it("salud o seguridad: directo a Pedilo, el comercio no propone", async () => {
    const o = await completedOrder();
    const res = await customer(o.orderId, o.token).open({ reason: "QUALITY", description: "Me cayó mal, estaba en mal estado", sensitive: true });
    expect(res.json()).toMatchObject({ status: "ESCALATED", sensitive: true });
    const p = await merchantPost(res.json().id, "propose", { type: "REFUND_FULL" });
    expect(p.json().error.details.reason).toBe("SENSITIVE");
    const list = (await req("GET", "/v1/admin/claims", { token: admin })).json();
    expect(list[0].sensitive).toBe(true); // sensibles primero
  });
});

describe("evidencia", () => {
  it("fotos reprocesadas, hasta 3", async () => {
    const o = await completedOrder();
    await customer(o.orderId, o.token).open({ reason: "QUALITY", description: "Llegó roto el envase" });
    const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#c33" } }).jpeg().toBuffer();
    const upload = () => {
      const boundary = `----pedilo${Math.random()}`;
      return ctx.app.inject({
        method: "PUT",
        url: `/v1/public/orders/${o.orderId}/claim/evidence`,
        headers: { "x-order-token": o.token, "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
          photo,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    };
    const first = await upload();
    expect(first.statusCode).toBe(200);
    expect(first.json().evidence[0]).toMatch(/^\/media\/merchants\/.+\.webp$/);
    await upload();
    await upload();
    expect((await upload()).json().error.details.reason).toBe("TOO_MANY_PHOTOS");
  });
});

describe("avisos de reclamos (ADR 0020)", () => {
  const outboxFor = (orderId: string) => ctx.db.select().from(notificationOutbox).where(eq(notificationOutbox.orderId, orderId));

  it("reclamo nuevo → comercio; propuesta → cliente (a su celular registrado)", async () => {
    const o = await completedOrder();
    const token = "ExponentPushToken[abc123xyz]";
    expect((await req("POST", `/v1/public/orders/${o.orderId}/push-token`, { headers: { "x-order-token": o.token }, payload: { expoToken: "basura" } })).statusCode).toBe(400);
    expect((await req("POST", `/v1/public/orders/${o.orderId}/push-token`, { headers: { "x-order-token": "otro-token-cualquiera" }, payload: { expoToken: token } })).statusCode).toBe(404);
    expect((await req("POST", `/v1/public/orders/${o.orderId}/push-token`, { headers: { "x-order-token": o.token }, payload: { expoToken: token } })).statusCode).toBe(204);
    // Idempotente.
    await req("POST", `/v1/public/orders/${o.orderId}/push-token`, { headers: { "x-order-token": o.token }, payload: { expoToken: token } });
    expect(await ctx.db.select().from(customerPushTokens).where(eq(customerPushTokens.orderId, o.orderId))).toHaveLength(1);

    const claimId = (await customer(o.orderId, o.token).open({ reason: "MISSING_ITEM", description: "Faltó la gaseosa grande" })).json().id;
    await merchantPost(claimId, "propose", { type: "REFUND_PARTIAL", amountMinor: 150_000 });

    const rows = (await outboxFor(o.orderId)).filter((r) => r.kind.startsWith("CLAIM_"));
    expect(rows.map((r) => [r.kind, r.audience])).toEqual([
      ["CLAIM_OPENED", "MERCHANT"],
      ["CLAIM_UPDATE", "CUSTOMER"],
    ]);
    expect(rows[0]!.payload).toMatchObject({ url: `/m/${merchantId}/claims/${claimId}`, title: expect.stringMatching(/^Reclamo nuevo/) });
    expect(rows[1]!.payload).toMatchObject({ url: `/order/${o.orderId}`, body: expect.stringContaining("devolución parcial de $ 1.500") });

    // El worker manda el aviso del cliente a su celular; un token dado de baja se borra.
    const sent: string[] = [];
    const sender: CustomerPushSender = {
      send: async (t, payload) => {
        sent.push(`${t}|${payload.title}`);
        return { ok: false, gone: true, error: "DeviceNotRegistered" };
      },
    };
    await processOutbox(ctx.db, null, new Date(), 50, sender);
    expect(sent).toEqual([`${token}|Respuesta a tu reclamo`]);
    expect(await ctx.db.select().from(customerPushTokens).where(eq(customerPushTokens.orderId, o.orderId))).toHaveLength(0);
    const after = (await outboxFor(o.orderId)).find((r) => r.audience === "CUSTOMER")!;
    expect(after.status).toBe("SKIPPED");
  });

  it("sin celular registrado, el aviso al cliente se omite sin trabar la cola", async () => {
    const o = await completedOrder();
    const claimId = (await customer(o.orderId, o.token).open({ reason: "DELAY", description: "Tardó dos horas en llegar" })).json().id;
    await merchantPost(claimId, "messages", { body: "Perdón, tuvimos un problema" });
    await processOutbox(ctx.db, null, new Date(), 50, { send: async () => ({ ok: true }) });
    const row = (await outboxFor(o.orderId)).find((r) => r.audience === "CUSTOMER")!;
    expect(row).toMatchObject({ status: "SKIPPED", lastError: "El cliente no registró su celular" });
  });
});

describe("métricas de reclamos (ADR 0020)", () => {
  it("por comercio: tasa, escalados, vencidos, tiempo a la propuesta, devuelto y motivos", async () => {
    const res = await req("GET", `/v1/merchants/${merchantId}/claims/metrics?days=30`, { token: owner });
    expect(res.statusCode).toBe(200);
    const m = res.json();
    expect(m.merchant.id).toBe(merchantId);
    expect(m.claims).toBeGreaterThanOrEqual(8);
    expect(m.completedOrders).toBeGreaterThanOrEqual(m.claims);
    expect(m.claimRatePer100).toBeCloseTo((m.claims / m.completedOrders) * 100, 0);
    expect(m.refundedMinor).toBe(400_000); // la devolución parcial registrada
    // Los dos que quedaron sin propuesta cuando corrió la escalada (el sensible no cuenta: no es demora del comercio).
    expect(m.slaMissed).toBe(2);
    expect(m.escalated).toBeGreaterThanOrEqual(3);
    expect(m.byReason.MISSING_ITEM).toBeGreaterThanOrEqual(2);
    expect(m.medianMinutesToProposal).toEqual(expect.any(Number));

    expect((await req("GET", `/v1/merchants/${merchantId}/claims/metrics`, { token: stranger })).statusCode).not.toBe(200);
    const all = (await req("GET", "/v1/admin/claims/metrics", { token: admin })).json();
    expect(all.find((x: { merchant: { id: string } }) => x.merchant.id === merchantId).claims).toBe(m.claims);
    expect((await req("GET", "/v1/admin/claims/metrics", { token: owner })).statusCode).toBe(403);
  });
});
