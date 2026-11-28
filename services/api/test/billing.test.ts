import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LAUNCH_PRICING_HYPOTHESIS } from "@pedilo/domain";

import { commissionEntries, pricingVersions } from "../src/db/schema";
import { accrueOrderCommission, getActivePricing } from "../src/modules/billing/service";
import { closeSettlementWeek, listSettlementsForAdmin } from "../src/modules/billing/settlements";
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
const req = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });

let keySeq = 0;
/** Pedido de `quantity` pizzas de $9.000 (retiro, efectivo). */
const order = (quantity: number) =>
  req("POST", "/v1/public/orders", {
    token: buyer,
    headers: { "idempotency-key": `billing-${++keySeq}-${Date.now()}` },
    payload: {
      merchantSlug: "la-esquina",
      branchId,
      fulfillmentType: "PICKUP",
      items: [{ productId: pizzaId, modifiers: [], quantity }],
    },
  });

const transition = (orderId: string, to: string) =>
  req("POST", `/v1/merchants/${merchantId}/orders/${orderId}/transition`, { token: owner, payload: { to } });

const complete = async (orderId: string) => {
  for (const to of ["ACCEPTED", "PREPARING", "READY", "PICKED_UP"]) expect((await transition(orderId, to)).statusCode).toBe(200);
};

const billing = () => req("GET", `/v1/merchants/${merchantId}/billing`, { token: owner });

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
      payload: { displayName: "La Esquina", legalName: "José Pérez", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
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

describe("pricing versionado", () => {
  it("las migraciones dejan vigente el 3% plano, sin mensualidad ni tope (ADR 0033)", async () => {
    const res = await req("GET", "/v1/pricing/current", { token: owner });
    expect(res.statusCode).toBe(200);
    const flat = { baseRateBps: 300, monthlyFeeMinor: 0 };
    expect(res.json()).toMatchObject({
      id: "v1-3pct",
      brackets: [{ upToMinor: null, rateFactorBps: 10000 }],
      plans: { EMPRENDEDOR: flat, NEGOCIO: flat, PRO: flat },
      capsByCategory: { GASTRONOMY: null, ELECTRONICS: null },
    });
    expect((await req("GET", "/v1/pricing/current")).statusCode).toBe(401);

    // 50 × $9.000 = $450.000 → 3% = $13.500, sin tope.
    const id = (await order(50)).json().order.id;
    const list = (await req("GET", `/v1/merchants/${merchantId}/orders`, { token: owner })).json() as Array<{ id: string; commission: unknown }>;
    expect(list.find((o) => o.id === id)!.commission).toMatchObject({ amountMinor: 1_350_000, pricingVersionId: "v1-3pct", capMinor: null, capApplied: false });
    await req("POST", `/v1/merchants/${merchantId}/orders/${id}/transition`, { token: owner, payload: { to: "REJECTED", reason: "Prueba" } });
  });

  it("una versión nueva solo hacia adelante, con tramos válidos e id único", async () => {
    const current = (await req("GET", "/v1/pricing/current", { token: owner })).json();
    const body = (over: Body) => ({
      id: "v0.5",
      brackets: current.brackets,
      capsByCategory: current.capsByCategory,
      plans: current.plans,
      effectiveFrom: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      ...over,
    });
    const post = (payload: Body, token = admin) => req("POST", "/v1/admin/pricing-versions", { token, payload });

    expect((await post(body({}), owner)).statusCode).toBe(403);
    expect((await post(body({ effectiveFrom: "2026-01-02T00:00:00Z" }))).statusCode).toBe(400);
    const badBrackets = [{ upToMinor: 3000000, rateFactorBps: 10000 }, { upToMinor: 1000000, rateFactorBps: 7000 }, { upToMinor: null, rateFactorBps: 4000 }];
    expect((await post(body({ brackets: badBrackets }))).statusCode).toBe(400);

    const created = await post(body({ plans: { ...current.plans, EMPRENDEDOR: { ...current.plans.EMPRENDEDOR, baseRateBps: 500 } } }));
    expect(created.statusCode).toBe(201);
    expect((await post(body({}))).statusCode).toBe(409);

    // Todavía no rige: la vigente sigue siendo la v1; desde su fecha, la nueva.
    expect((await getActivePricing(ctx.db)).id).toBe("v1-3pct");
    expect((await getActivePricing(ctx.db, new Date(Date.now() + 8 * 86_400_000))).id).toBe("v0.5");
    expect((await req("GET", "/v1/admin/pricing-versions", { token: admin })).json().map((v: { id: string }) => v.id)).toEqual([
      "v0.5",
      "v1-3pct",
      "v0.4-hypothesis",
    ]);
  });
});

describe("comisión por pedido y ledger", () => {
  let firstOrderId: string;

  // La mecánica de planes, tramos y topes se prueba con los precios de la v0.4, que la tienen toda.
  // Rige desde ahora (después de la v1), sin pasar por la regla de «solo hacia adelante» de la API.
  beforeAll(async () => {
    const { id: _id, ...v04 } = LAUNCH_PRICING_HYPOTHESIS;
    await ctx.db.insert(pricingVersions).values({
      id: "test-tramos",
      brackets: [...v04.brackets],
      capsByCategory: { ...v04.capsByCategory },
      plans: { ...v04.plans },
      effectiveFrom: new Date(),
    });
  });

  it("sin plan asignado: Emprendedor 6%, congelada en el pedido; el cliente no la ve", async () => {
    const res = await order(1); // $9.000 → 6% = $540
    expect(res.statusCode).toBe(201);
    expect(res.json().order).not.toHaveProperty("commission");
    firstOrderId = res.json().order.id;

    const list = (await req("GET", `/v1/merchants/${merchantId}/orders`, { token: owner })).json();
    expect(list.find((o: { id: string }) => o.id === firstOrderId).commission).toEqual({
      amountMinor: 54000,
      basisMinor: 900000,
      plan: "EMPRENDEDOR",
      pricingVersionId: "test-tramos",
      capMinor: 500000,
      capApplied: false,
    });

    const b = (await billing()).json();
    expect(b).toMatchObject({ plan: { code: "EMPRENDEDOR", since: null }, category: "GASTRONOMY", capMinor: 500000, balanceMinor: 0 });
  });

  it("se devenga una sola vez al completar el pedido", async () => {
    await complete(firstOrderId);
    const b = (await billing()).json();
    expect(b.balanceMinor).toBe(54000);
    expect(b.entries).toEqual([
      expect.objectContaining({ kind: "ACCRUED", amountMinor: 54000, orderId: firstOrderId, description: expect.stringMatching(/^Comisión pedido P-/) }),
    ]);

    // Reintento: el índice único evita el doble devengo.
    await accrueOrderCommission(ctx.db, { id: firstOrderId, code: "P-XXXX", merchantId, commissionMinor: 54000 });
    expect((await billing()).json().balanceMinor).toBe(54000);
  });

  it("un pedido rechazado no devenga", async () => {
    const id = (await order(1)).json().order.id;
    await req("POST", `/v1/merchants/${merchantId}/orders/${id}/transition`, { token: owner, payload: { to: "REJECTED", reason: "Sin stock" } });
    expect((await billing()).json().balanceMinor).toBe(54000);
  });

  it("cambiar de plan rige desde ahora: el pedido anterior conserva su comisión", async () => {
    const pending = (await order(1)).json().order.id; // creado con Emprendedor
    const res = await req("PUT", `/v1/admin/merchants/${merchantId}/plan`, { token: admin, payload: { plan: "NEGOCIO", reason: "Pidió el cambio" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: { code: "NEGOCIO", baseRateBps: 400, monthlyFeeMinor: 2500000 } });

    const after = (await order(1)).json().order.id; // 4% = $360
    const list = (await req("GET", `/v1/merchants/${merchantId}/orders`, { token: owner })).json() as Array<{ id: string; commission: { amountMinor: number; plan: string } }>;
    expect(list.find((o) => o.id === pending)!.commission).toMatchObject({ amountMinor: 54000, plan: "EMPRENDEDOR" });
    expect(list.find((o) => o.id === after)!.commission).toMatchObject({ amountMinor: 36000, plan: "NEGOCIO" });

    await complete(pending);
    await complete(after);
    expect((await billing()).json().balanceMinor).toBe(54000 + 54000 + 36000);

    // Mismo plan otra vez: no abre un período nuevo.
    await req("PUT", `/v1/admin/merchants/${merchantId}/plan`, { token: admin, payload: { plan: "NEGOCIO" } });
    expect((await billing()).json().history).toEqual([
      expect.objectContaining({ code: "NEGOCIO", endsAt: null, reason: "Pidió el cambio" }),
    ]);
    expect((await req("PUT", `/v1/admin/merchants/${merchantId}/plan`, { token: owner, payload: { plan: "PRO" } })).statusCode).toBe(403);
  });

  it("tramos marginales y tope del rubro (SPEC §6.2)", async () => {
    // 50 × $9.000 = $450.000 en Negocio: 30.000×4% + 70.000×2,8% + 350.000×1,6% = $8.760 → tope $5.000.
    const id = (await order(50)).json().order.id;
    const list = (await req("GET", `/v1/merchants/${merchantId}/orders`, { token: owner })).json() as Array<{ id: string; commission: unknown }>;
    expect(list.find((o) => o.id === id)!.commission).toMatchObject({ amountMinor: 500000, capMinor: 500000, capApplied: true });
  });

  it("ajustes del admin: asiento compensatorio con motivo", async () => {
    const before = (await billing()).json().balanceMinor;
    const post = (payload: Body, token = admin) =>
      req("POST", `/v1/admin/merchants/${merchantId}/commission-adjustments`, { token, payload });
    expect((await post({ amountMinor: 0, description: "Nada" })).statusCode).toBe(400);
    expect((await post({ amountMinor: -1000, description: "Bonificación" }, owner)).statusCode).toBe(403);
    const res = await post({ amountMinor: -10000, description: "Bonificación por demora" });
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe(before - 10000);
    expect(res.json().entries[0]).toMatchObject({ kind: "ADJUSTMENT", amountMinor: -10000, orderId: null });
  });

  it("el ledger es append-only: no se editan ni borran asientos", async () => {
    await expect(ctx.db.update(commissionEntries).set({ amountMinor: 1 }).where(eq(commissionEntries.merchantId, merchantId))).rejects.toThrow();
    await expect(ctx.db.execute(sql`delete from commission_entries`)).rejects.toThrow();
  });

  it("solo los miembros ven el estado de cuenta del comercio", async () => {
    expect((await req("GET", `/v1/merchants/${merchantId}/billing`, { token: stranger })).statusCode).not.toBe(200);
    expect((await req("GET", `/v1/admin/merchants/${merchantId}/billing`, { token: owner })).statusCode).toBe(403);
    expect((await req("GET", `/v1/admin/merchants/${merchantId}/billing`, { token: admin })).statusCode).toBe(200);
  });
});

describe("liquidación semanal (ADR 0013)", () => {
  const DAY = 86_400_000;
  const at = (days: number) => new Date(Date.now() + days * DAY);
  const adjust = (amountMinor: number, description: string) =>
    req("POST", `/v1/admin/merchants/${merchantId}/commission-adjustments`, { token: admin, payload: { amountMinor, description } });
  const pay = (settlementId: string, amountMinor: number) =>
    req("POST", `/v1/admin/settlements/${settlementId}/payments`, {
      token: admin,
      payload: { amountMinor, method: "TRANSFER", reference: "op-123" },
    });
  let firstId: string;
  let owed: number;

  it("cierra la semana: agrupa lo no liquidado, una sola vez", async () => {
    const before = (await billing()).json();
    owed = before.balanceMinor;
    expect(owed).toBeGreaterThan(0);
    expect(before.unsettledMinor).toBe(owed);

    expect(await closeSettlementWeek(ctx.db, { now: at(8) })).toBe(1);
    expect(await closeSettlementWeek(ctx.db, { now: at(8) })).toBe(0);

    const after = (await billing()).json();
    expect(after).toMatchObject({ balanceMinor: owed, unsettledMinor: 0 });
    expect(after.settlements).toHaveLength(1);
    const s = after.settlements[0];
    firstId = s.id;
    expect(s).toMatchObject({ totalMinor: owed, paidMinor: 0, outstandingMinor: owed, status: "PENDING" });
    expect(new Date(s.dueAt).getTime() - new Date(s.periodEnd).getTime()).toBe(7 * DAY);
    // El corte es un lunes 00:00 en Argentina (03:00 UTC).
    expect(new Date(s.periodEnd).getUTCDay()).toBe(1);
    expect(new Date(s.periodEnd).getUTCHours()).toBe(3);
  });

  it("pagos parciales; nunca más de lo adeudado", async () => {
    const half = Math.floor(owed / 2);
    const partial = await pay(firstId, half);
    expect(partial.statusCode).toBe(201);
    expect(partial.json()).toMatchObject({ status: "PARTIALLY_PAID", paidMinor: half, outstandingMinor: owed - half });
    expect((await billing()).json().balanceMinor).toBe(owed - half);

    const over = await pay(firstId, owed);
    expect(over.statusCode).toBe(409);
    expect(over.json().error.details).toMatchObject({ reason: "OVERPAYMENT", outstandingMinor: owed - half });

    expect((await pay(firstId, owed - half)).json()).toMatchObject({ status: "PAID", outstandingMinor: 0 });
    expect((await pay(firstId, 100)).json().error.details.reason).toBe("ALREADY_PAID");
    expect((await billing()).json().balanceMinor).toBe(0);
    expect((await pay(firstId, 100)).statusCode).toBe(409);
    expect((await req("POST", `/v1/admin/settlements/${firstId}/payments`, { token: owner, payload: { amountMinor: 1, method: "CASH" } })).statusCode).toBe(403);
  });

  it("un saldo a favor no se liquida: pasa a la semana siguiente y compensa", async () => {
    await adjust(-30000, "Bonificación");
    expect(await closeSettlementWeek(ctx.db, { now: at(15) })).toBe(0);
    expect((await billing()).json()).toMatchObject({ balanceMinor: -30000, unsettledMinor: -30000 });

    await adjust(50000, "Cargo por error de carga");
    expect(await closeSettlementWeek(ctx.db, { now: at(15) })).toBe(1);
    const s = (await billing()).json().settlements[0];
    expect(s).toMatchObject({ totalMinor: 20000, entryCount: 2, status: "PENDING" });

    // Pasado el vencimiento sin pagar: vencida.
    const later = await listSettlementsForAdmin(ctx.db, "OVERDUE", at(40));
    expect(later.map((x) => x.id)).toContain(s.id);
    expect(later.find((x) => x.id === s.id)!.merchant.name).toBe("La Esquina");
  });

  it("detalle: el comercio ve sus liquidaciones con asientos y pagos; otros no", async () => {
    const mine = await req("GET", `/v1/merchants/${merchantId}/settlements/${firstId}`, { token: owner });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().payments).toHaveLength(2);
    expect(mine.json().entries.reduce((n: number, e: { amountMinor: number }) => n + e.amountMinor, 0)).toBe(owed);
    expect((await req("GET", `/v1/merchants/${merchantId}/settlements/${firstId}`, { token: stranger })).statusCode).not.toBe(200);
    expect((await req("GET", `/v1/admin/settlements/${firstId}`, { token: admin })).statusCode).toBe(200);
    expect((await req("GET", "/v1/admin/settlements?status=PAID", { token: admin })).json().map((x: { id: string }) => x.id)).toContain(firstId);
  });

  it("cierre manual del admin y append-only", async () => {
    const res = await req("POST", "/v1/admin/settlements/close", { token: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ created: expect.any(Number) });
    expect((await req("POST", "/v1/admin/settlements/close", { token: owner })).statusCode).toBe(403);
    await expect(ctx.db.execute(sql`update settlements set total_minor = 1`)).rejects.toThrow();
    await expect(ctx.db.execute(sql`delete from settlement_payments`)).rejects.toThrow();
  });
});
