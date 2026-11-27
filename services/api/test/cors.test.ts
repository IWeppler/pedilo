import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ corsOrigins: ["http://localhost:8082"] });
});
afterAll(() => ctx.close());

describe("CORS", () => {
  it("el navegador puede usar PATCH, PUT y DELETE desde un origen permitido", async () => {
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const res = await ctx.app.inject({
        method: "OPTIONS",
        url: "/v1/courier/me",
        headers: {
          origin: "http://localhost:8082",
          "access-control-request-method": method,
          "access-control-request-headers": "authorization,content-type",
        },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:8082");
      expect(String(res.headers["access-control-allow-methods"])).toContain(method);
    }
  });

  it("un origen que no está en la lista no recibe permiso", async () => {
    const res = await ctx.app.inject({
      method: "OPTIONS",
      url: "/v1/courier/me",
      headers: { origin: "https://otro.example", "access-control-request-method": "PATCH" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
