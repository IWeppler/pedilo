import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { escalateOverdueClaims, openClaim } from "../src/modules/claims/service";
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
