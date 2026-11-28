import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext({ limits: { perIpPer10Min: 3, maxActivePerPhone: 0, maxDailyPerPhone: 0 } });
});
afterAll(() => ctx.close());

describe("límite por IP al crear pedidos (ADR 0010)", () => {
  it("después del máximo responde 429 RATE_LIMITED con retry-after", async () => {
    const buyer = await ctx.customerToken();
    const post = () =>
      ctx.app.inject({ method: "POST", url: "/v1/public/orders", headers: { ...bearer(buyer), "idempotency-key": "rate-limit-key-1" }, payload: {} });

    // Sin sesión se rechaza antes (401) y no gasta el cupo.
    expect((await ctx.app.inject({ method: "POST", url: "/v1/public/orders", headers: { "idempotency-key": "x" }, payload: {} })).statusCode).toBe(401);
    // Con sesión, los requests cuentan aunque sean inválidos (el límite corre antes de validar).
    for (let i = 0; i < 3; i++) expect((await post()).statusCode).toBe(400);

    const blocked = await post();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toMatchObject({ code: "RATE_LIMITED", details: { reason: "IP_RATE_LIMIT" } });
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("no afecta a las demás rutas públicas", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/v1/cities" })).statusCode).toBe(200);
  });
});
