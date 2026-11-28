import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { emailOutbox, type OrderEmailData, users } from "../src/db/schema";
import { type EmailMessage, type EmailResult, type EmailSender, processEmailOutbox, renderEmail } from "../src/modules/notifications/email";
import { bearer, createTestContext, type TestContext } from "./helpers";

/** Emails al cliente (ADR 0032): se encolan con el pedido y los manda el worker. */

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

async function order(buyer: string) {
  const res = await req("POST", "/v1/public/orders", {
    token: buyer,
    headers: { "idempotency-key": `email-${++seq}-${Date.now()}` },
    payload: { merchantSlug: "panchos-del-centro", branchId, fulfillmentType: "PICKUP", items: [{ productId, modifiers: [], quantity: 2 }] },
  });
  const body = res.json();
  return { id: body.order.id as string, trackingToken: body.trackingToken as string };
}
const transition = (orderId: string, to: string, reason?: string) =>
  req("POST", `/v1/merchants/${merchantId}/orders/${orderId}/transition`, { token: owner, payload: { to, ...(reason && { reason }) } });
const emailsFor = (orderId: string) => ctx.db.select().from(emailOutbox).where(eq(emailOutbox.orderId, orderId));

/** Sender de prueba: guarda lo que manda y responde lo que se le pida. */
function fakeSender(respond: () => EmailResult = () => ({ ok: true, id: "re_123" })): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(m) {
      sent.push(m);
      return respond();
    },
  };
}

beforeAll(async () => {
  ctx = await createTestContext();
  const admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Panchos del Centro", legalName: "Luis Pérez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
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
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, { token: owner, payload: { name: "Pancho <especial>", priceMinor: 350_050, variants: [], modifierGroups: [] } })
  ).json().id;
});
afterAll(() => ctx.close());
// Cada test parte con la outbox vacía (lo que quedó de otro test no se manda acá).
beforeEach(async () => {
  await ctx.db.delete(emailOutbox);
});

describe("emails al cliente (ADR 0032)", () => {
  it("pedido aceptado: se encola y el worker lo manda al email del cliente", async () => {
    const buyer = await ctx.customerToken({ displayName: "Ana María" });
    const { id } = await order(buyer);
    expect(await emailsFor(id)).toHaveLength(0); // hacer el pedido no manda email

    await transition(id, "ACCEPTED");
    const [row] = await emailsFor(id);
    expect(row).toMatchObject({ kind: "ORDER_ACCEPTED", status: "PENDING" });
    const [user] = await ctx.db.select().from(users).where(eq(users.id, row!.userId));

    const sender = fakeSender();
    expect(await processEmailOutbox(ctx.db, sender, { appUrl: "https://app.pedilo.test" })).toBe(1);
    const [m] = sender.sent;
    expect(m!.to).toBe(user!.email);
    expect(m!.subject).toBe(`Panchos del Centro aceptó tu pedido ${(row!.data as OrderEmailData).code}`);
    expect(m!.idempotencyKey).toBe(`email-${row!.id}`);
    expect(m!.text).toContain("Hola Ana:");
    expect(m!.text).toContain("2 × Pancho <especial>");
    expect(m!.text).toContain("$ 7.001"); // pesos enteros, half-up
    expect(m!.html).toContain("Pancho &lt;especial&gt;");
    expect(m!.html).toContain(`href="https://app.pedilo.test/order/${id}"`);
    expect((await emailsFor(id))[0]).toMatchObject({ status: "SENT", providerId: "re_123" });

    // Lo siguiente del pedido (preparando, listo) no manda más emails.
    await transition(id, "PREPARING");
    await transition(id, "READY");
    expect(await emailsFor(id)).toHaveLength(1);
  });

  it("rechazo con motivo; la cancelación del propio cliente no manda nada", async () => {
    const buyer = await ctx.customerToken();
    const rejected = await order(buyer);
    await transition(rejected.id, "REJECTED", "Nos quedamos sin pan");
    const [row] = await emailsFor(rejected.id);
    expect(row).toMatchObject({ kind: "ORDER_REJECTED", data: { reason: "Nos quedamos sin pan", refund: false } });

    const sender = fakeSender();
    await processEmailOutbox(ctx.db, sender);
    expect(sender.sent[0]!.text).toContain("Motivo: Nos quedamos sin pan");
    expect(sender.sent[0]!.html).not.toContain("Ver mi pedido"); // sin URL de la app, sin botón

    const own = await order(buyer);
    const cancel = await req("POST", `/v1/public/orders/${own.id}/cancel`, { headers: { "x-order-token": own.trackingToken }, payload: {} });
    expect(cancel.statusCode).toBe(200);
    expect(await emailsFor(own.id)).toHaveLength(0);
  });

  it("sin proveedor queda SKIPPED; error transitorio se reintenta; rechazo definitivo → FAILED", async () => {
    const buyer = await ctx.customerToken();
    const a = await order(buyer);
    await transition(a.id, "ACCEPTED");
    await processEmailOutbox(ctx.db, null);
    expect((await emailsFor(a.id))[0]).toMatchObject({ status: "SKIPPED", lastError: "Email sin configurar (RESEND_API_KEY)" });

    const b = await order(buyer);
    await transition(b.id, "ACCEPTED");
    const now = new Date();
    await processEmailOutbox(ctx.db, fakeSender(() => ({ ok: false, permanent: false, error: "Resend HTTP 503" })), { appUrl: null }, now);
    const [retry] = await emailsFor(b.id);
    expect(retry).toMatchObject({ status: "PENDING", attempts: 1, lastError: "Resend HTTP 503" });
    expect(retry!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());
    // Antes de la espera no se vuelve a tomar.
    expect(await processEmailOutbox(ctx.db, fakeSender(), { appUrl: null }, now)).toBe(0);

    await processEmailOutbox(
      ctx.db,
      fakeSender(() => ({ ok: false, permanent: true, error: "Resend HTTP 422" })),
      { appUrl: null },
      new Date(retry!.nextAttemptAt.getTime() + 1),
    );
    expect((await emailsFor(b.id))[0]).toMatchObject({ status: "FAILED", attempts: 2, lastError: "Resend HTTP 422" });
  });

  it("sin email del usuario queda SKIPPED", async () => {
    const buyer = await ctx.customerToken();
    const { id } = await order(buyer);
    await transition(id, "ACCEPTED");
    const [row] = await emailsFor(id);
    await ctx.db.update(users).set({ email: null }).where(eq(users.id, row!.userId));
    const sender = fakeSender();
    await processEmailOutbox(ctx.db, sender);
    expect(sender.sent).toHaveLength(0);
    expect((await emailsFor(id))[0]).toMatchObject({ status: "SKIPPED", lastError: "El usuario no tiene email" });
  });
});

describe("renderEmail", () => {
  it("escapa el contenido y arma la versión en texto", () => {
    const out = renderEmail({
      preheader: "Hola",
      title: `Pedido "A&B"`,
      paragraphs: ["<script>alert(1)</script>"],
      details: [["Total", "$ 100"]],
      action: { label: "Ver", url: "https://x.test/?a=1&b=2" },
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("Pedido &quot;A&amp;B&quot;");
    expect(out.html).toContain('href="https://x.test/?a=1&amp;b=2"');
    expect(out.text).toContain("Total: $ 100");
    expect(out.text).toContain("Ver: https://x.test/?a=1&b=2");
  });
});
