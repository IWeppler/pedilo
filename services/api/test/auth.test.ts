import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { users } from "../src/db/schema";
import { generateDevKeyPair } from "../src/modules/identity/dev-keys";
import { LOCAL_DEV_ISSUER, TOKEN_AUDIENCE } from "../src/modules/identity/token-verifier";
import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());

describe("sistema", () => {
  it("GET /health responde ok y devuelve x-request-id", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("respeta el x-request-id entrante", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "abc-123" } });
    expect(res.headers["x-request-id"]).toBe("abc-123");
  });

  it("ruta inexistente → 404 con forma de error estándar", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/nada" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("el documento OpenAPI se genera", async () => {
    const doc = ctx.app.swagger() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/me", "/v1/cities", "/v1/admin/cities", "/v1/categories"]),
    );
  });
});

describe("autenticación (ADR 0004)", () => {
  it("sin token → 401 en /v1/me", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("primer request con token válido crea el usuario, sin rol", async () => {
    const { token, userId } = await ctx.tokenFor({ email: "ana@test.pedilo.local" });
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: userId, email: "ana@test.pedilo.local", phone: null, platformRole: null });

    const [row] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(row?.email).toBe("ana@test.pedilo.local");
  });

  it("token firmado con otra clave → 401, aunque la ruta sea pública", async () => {
    const otherKeys = await generateDevKeyPair();
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .setSubject(crypto.randomUUID())
      .setIssuer(LOCAL_DEV_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setExpirationTime("1h")
      .sign(otherKeys.privateKey);
    const res = await ctx.app.inject({ method: "GET", url: "/v1/cities", headers: bearer(forged) });
    expect(res.statusCode).toBe(401);
  });

  it("header Authorization mal formado → 401", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: "Token abc" } });
    expect(res.statusCode).toBe(401);
  });

  it("usuario suspendido → 403", async () => {
    const { token, userId } = await ctx.tokenFor();
    await ctx.db.insert(users).values({ id: userId, status: "SUSPENDED" });
    const res = await ctx.app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) });
    expect(res.statusCode).toBe(403);
  });

  it("el rol se lee de la base en cada request, no del token", async () => {
    const { token, userId } = await ctx.tokenFor();
    const before = await ctx.app.inject({ method: "GET", url: "/v1/admin/cities", headers: bearer(token) });
    expect(before.statusCode).toBe(403);

    await ctx.db.update(users).set({ platformRole: "ADMIN" }).where(eq(users.id, userId));
    const after = await ctx.app.inject({ method: "GET", url: "/v1/admin/cities", headers: bearer(token) });
    expect(after.statusCode).toBe(200);
  });
});
