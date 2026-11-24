import { describe, expect, it } from "vitest";

import { ApiError, createApiClient, fieldErrors, unwrap } from "./index";

function fakeFetch(status: number, body: unknown) {
  const seen: Request[] = [];
  const fetch = async (request: Request) => {
    seen.push(request);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, seen };
}

describe("createApiClient", () => {
  it("agrega el token como Bearer y usa la baseUrl", async () => {
    const { fetch, seen } = fakeFetch(200, []);
    const api = createApiClient({ baseUrl: "http://api.test", getToken: () => "tok-123", fetch });
    await unwrap(api.GET("/v1/cities"));
    expect(seen[0]?.url).toBe("http://api.test/v1/cities");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer tok-123");
  });

  it("sin token no manda Authorization", async () => {
    const { fetch, seen } = fakeFetch(200, []);
    const api = createApiClient({ baseUrl: "http://api.test", getToken: () => null, fetch });
    await unwrap(api.GET("/v1/categories", { params: { query: { kind: "MERCHANT" } } }));
    expect(seen[0]?.headers.has("authorization")).toBe(false);
    expect(seen[0]?.url).toBe("http://api.test/v1/categories?kind=MERCHANT");
  });
});

describe("unwrap", () => {
  it("lanza ApiError con status, code y details", async () => {
    const { fetch } = fakeFetch(409, { error: { code: "CONFLICT", message: "Ya existe", details: { a: 1 } } });
    const api = createApiClient({ baseUrl: "http://api.test", fetch });
    const err = await unwrap(api.POST("/v1/admin/cities", { body: { name: "Tostado", province: "Santa Fe" } })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "CONFLICT", message: "Ya existe", details: { a: 1 } });
  });

  it("respuesta de error sin forma estándar → code UNKNOWN", async () => {
    const { fetch } = fakeFetch(502, { oops: true });
    const api = createApiClient({ baseUrl: "http://api.test", fetch });
    await expect(unwrap(api.GET("/v1/cities"))).rejects.toMatchObject({ status: 502, code: "UNKNOWN" });
  });
});

describe("fieldErrors", () => {
  it("mapea los paths de validación a nombres de campo", () => {
    const err = new ApiError(400, "VALIDATION_ERROR", "inválido", [
      { path: "/name", message: "Muy corto" },
      { path: "/name", message: "Segundo mensaje, se ignora" },
      { path: "/address/street", message: "Requerido" },
      { path: "", message: "Enviá al menos un campo" },
    ]);
    expect(fieldErrors(err)).toEqual({
      name: "Muy corto",
      "address.street": "Requerido",
      _form: "Enviá al menos un campo",
    });
  });

  it("otros errores devuelven objeto vacío", () => {
    expect(fieldErrors(new ApiError(409, "CONFLICT", "x"))).toEqual({});
    expect(fieldErrors(new Error("x"))).toEqual({});
  });
});
