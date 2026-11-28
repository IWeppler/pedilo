import { localDateKey } from "@pedilo/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
/** Cliente registrado: solo así se puede pedir (ADR 0026). */
let buyer: string;
let owner: string;
let stranger: string;
let merchantId: string;
let branchId: string;
let productId: string;
const tz = "America/Argentina/Buenos_Aires";

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, opts: { token?: string; payload?: Body; headers?: Record<string, string> } = {}) =>
  ctx.app.inject({
    method,
    url,
    headers: { ...(opts.token && bearer(opts.token)), ...opts.headers },
    ...(opts.payload !== undefined && { payload: opts.payload }),
  });
const day = (offset: number) => localDateKey(new Date(Date.now() + offset * 86_400_000), tz);
const closuresUrl = () => `/v1/merchants/${merchantId}/branches/${branchId}/closures`;
const publicBranch = async () => (await req("GET", "/v1/public/merchants/cafe-feriado")).json().merchant.branches[0];

beforeAll(async () => {
  ctx = await createTestContext();
  buyer = await ctx.customerToken();
  const admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  stranger = (await ctx.tokenFor()).token;
  const cityId = (await req("POST", "/v1/admin/cities", { token: admin, payload: { name: "Tostado", province: "Santa Fe" } })).json().id;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Café Feriado", legalName: "Ana López", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id;
  branchId = (
    await req("POST", `/v1/merchants/${merchantId}/branches`, { token: owner, payload: { name: "Centro", cityId, addressLine: "San Martín 1", acceptsPickup: true } })
  ).json().id;
  const allDay = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: "00:00", closesAt: "24:00" }));
  await req("PUT", `/v1/merchants/${merchantId}/branches/${branchId}/hours`, { token: owner, payload: { ranges: allDay } });
  await req("PATCH", `/v1/merchants/${merchantId}/branches/${branchId}`, { token: owner, payload: { scheduling: { enabled: true, leadMinutes: 60, maxDays: 3 } } });
  await req("POST", `/v1/merchants/${merchantId}/submit`, { token: owner });
  await req("POST", `/v1/admin/merchants/${merchantId}/approve`, { token: admin });
  productId = (
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, { token: owner, payload: { name: "Café", priceMinor: 200000, variants: [], modifierGroups: [] } })
  ).json().id;
});
afterAll(() => ctx.close());

describe("cierres excepcionales (ADR 0018)", () => {
  let todayClosureId: string;

  it("valida fechas: no en el pasado, fin ≥ inicio, hasta 60 días; solo el dueño", async () => {
    const post = (payload: Body, token = owner) => req("POST", closuresUrl(), { token, payload });
    expect((await post({ startsOn: day(-5), endsOn: day(-3), reason: "Feriado" })).json().error.details.reason).toBe("IN_THE_PAST");
    expect((await post({ startsOn: day(3), endsOn: day(2), reason: "Feriado" })).json().error.details.reason).toBe("ENDS_BEFORE_START");
    expect((await post({ startsOn: day(1), endsOn: day(90), reason: "Vacaciones" })).json().error.details.reason).toBe("TOO_LONG");
    expect((await post({ startsOn: day(1), endsOn: day(1), reason: "Feriado" }, stranger)).statusCode).toBe(404);
  });

  it("cerrado hoy: no figura abierto, el cliente ve el motivo y no se puede pedir para ahora", async () => {
    expect((await publicBranch()).openNow).toBe(true);
    const res = await req("POST", closuresUrl(), { token: owner, payload: { startsOn: day(0), endsOn: day(0), reason: "Feriado" } });
    expect(res.statusCode).toBe(201);
    todayClosureId = res.json().closures[0].id;

    const b = await publicBranch();
    expect(b).toMatchObject({ openNow: false, closedToday: { reason: "Feriado", endsOn: day(0) } });
    const order = await req("POST", "/v1/public/orders", {
    token: buyer,
      headers: { "idempotency-key": `closure-${Date.now()}` },
      payload: { merchantSlug: "cafe-feriado", branchId, fulfillmentType: "PICKUP", items: [{ productId, modifiers: [], quantity: 1 }] },
    });
    expect(order.json().error.details.reason).toBe("BRANCH_CLOSED");
  });

  it("las franjas de programados saltean los días cerrados", async () => {
    await req("POST", closuresUrl(), { token: owner, payload: { startsOn: day(1), endsOn: day(1), reason: "Inventario" } });
    const { slots } = (await req("GET", `/v1/public/merchants/cafe-feriado/branches/${branchId}/slots`)).json() as { slots: Array<{ startsAt: string }> };
    const days = new Set(slots.map((s) => localDateKey(new Date(s.startsAt), tz)));
    expect(days.has(day(0))).toBe(false);
    expect(days.has(day(1))).toBe(false);
    expect(days.has(day(2))).toBe(true);
    expect((await publicBranch()).closures.map((c: { reason: string }) => c.reason)).toEqual(["Feriado", "Inventario"]);
  });

  it("quitar el cierre lo vuelve a abrir", async () => {
    const res = await req("DELETE", `${closuresUrl()}/${todayClosureId}`, { token: owner });
    expect(res.statusCode).toBe(200);
    expect((await publicBranch()).openNow).toBe(true);
    expect((await req("DELETE", `${closuresUrl()}/${todayClosureId}`, { token: owner })).statusCode).toBe(404);
  });
});
