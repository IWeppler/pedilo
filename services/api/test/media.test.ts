import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let dir: string;
let owner: string;
let stranger: string;
let merchantId: string;
let productId: string;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, opts: { token?: string; payload?: Body } = {}) =>
  ctx.app.inject({ method, url, headers: { ...(opts.token && bearer(opts.token)) }, ...(opts.payload && { payload: opts.payload }) });

/** Request multipart armado a mano (campo `file`). */
function upload(url: string, token: string, bytes: Buffer, filename = "foto.jpg", type = "image/jpeg") {
  const boundary = `----pedilo${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return ctx.app.inject({
    method: "PUT",
    url,
    headers: { ...bearer(token), "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

/** Foto de celular: 2000 × 1500, JPEG, con ubicación GPS en los metadatos. */
const phonePhoto = () =>
  sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 230, g: 120, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "Pedilo Phone" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "30/1 18/1 0/1" } })
    .toBuffer();

/** El path de la foto dentro de `/media/...` (o falla si no es local). */
const mediaGet = (url: string) => ctx.app.inject({ method: "GET", url });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pedilo-media-"));
  ctx = await createTestContext({ media: { driver: "local", dir } });
  const admin = await ctx.adminToken();
  owner = (await ctx.tokenFor()).token;
  stranger = (await ctx.tokenFor()).token;
  const rubro = (await req("POST", "/v1/admin/categories", { token: admin, payload: { kind: "MERCHANT", name: "Gastronomía" } })).json().id;
  merchantId = (
    await req("POST", "/v1/merchants", {
      token: owner,
      payload: { displayName: "Café Fotos", legalName: "Ana López", taxId: "20-12345678-6", categoryId: rubro, contactPhone: "3491 123456" },
    })
  ).json().id;
  productId = (
    await req("POST", `/v1/merchants/${merchantId}/menu/products`, {
      token: owner,
      payload: { name: "Medialuna", priceMinor: 80000, variants: [], modifierGroups: [] },
    })
  ).json().id;
});
afterAll(async () => {
  await ctx.close();
  await rm(dir, { recursive: true, force: true });
});

describe("fotos de producto (ADR 0017)", () => {
  const url = () => `/v1/merchants/${merchantId}/menu/products/${productId}/image`;
  let firstUrl: string;

  it("se reprocesa: WebP, máximo 1200 px y sin metadatos (ni GPS)", async () => {
    const original = await phonePhoto();
    // La de entrada sí trae metadatos (con GPS): si no, el chequeo de abajo no probaría nada.
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const res = await upload(url(), owner, original);
    expect(res.statusCode).toBe(200);
    firstUrl = res.json().imageUrl;
    expect(firstUrl).toMatch(new RegExp(`^/media/merchants/${merchantId}/product-${productId}-[0-9a-f]{12}\\.webp$`));

    const file = await mediaGet(firstUrl);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/webp");
    expect(file.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    const meta = await sharp(file.rawPayload).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 1200, height: 900 });
    expect(meta.exif).toBeUndefined();
  });

  it("reemplazar borra la anterior; el menú del comercio la muestra", async () => {
    const res = await upload(url(), owner, await phonePhoto());
    const secondUrl = res.json().imageUrl;
    expect(secondUrl).not.toBe(firstUrl);
    expect((await mediaGet(firstUrl)).statusCode).toBe(404);
    const menu = (await req("GET", `/v1/merchants/${merchantId}/menu`, { token: owner })).json();
    expect(menu.products[0].imageUrl).toBe(secondUrl);
  });

  it("rechaza lo que no es imagen, imágenes chicas, sin archivo y usuarios ajenos", async () => {
    expect((await upload(url(), owner, Buffer.from("no soy una imagen"), "x.jpg")).json().error.message).toBe("El archivo no es una imagen válida");
    const tiny = await sharp({ create: { width: 50, height: 50, channels: 3, background: "#fff" } }).png().toBuffer();
    expect((await upload(url(), owner, tiny, "x.png", "image/png")).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "PUT", url: url(), headers: bearer(owner), payload: { a: 1 } })).statusCode).toBe(400);
    expect((await upload(url(), stranger, await phonePhoto())).statusCode).not.toBe(200);
  });

  it("quitar la foto la borra del almacenamiento", async () => {
    const before = (await req("GET", `/v1/merchants/${merchantId}/menu`, { token: owner })).json().products[0].imageUrl;
    const res = await req("DELETE", url(), { token: owner });
    expect(res.json().imageUrl).toBeNull();
    expect((await mediaGet(before)).statusCode).toBe(404);
  });
});

describe("logo y portada", () => {
  it("logo cuadrado de 512 y portada de 1600 × 640", async () => {
    const logo = await upload(`/v1/merchants/${merchantId}/images/logo`, owner, await phonePhoto());
    expect(logo.statusCode).toBe(200);
    const cover = await upload(`/v1/merchants/${merchantId}/images/cover`, owner, await phonePhoto());
    const { logoUrl, coverUrl } = cover.json();
    expect(logo.json().logoUrl).toBe(logoUrl);
    expect(await sharp((await mediaGet(logoUrl)).rawPayload).metadata()).toMatchObject({ width: 512, height: 512 });
    expect(await sharp((await mediaGet(coverUrl)).rawPayload).metadata()).toMatchObject({ width: 1600, height: 640 });

    expect((await req("DELETE", `/v1/merchants/${merchantId}/images/logo`, { token: owner })).json().logoUrl).toBeNull();
    expect((await upload(`/v1/merchants/${merchantId}/images/banner`, owner, await phonePhoto())).statusCode).toBe(400);
  });

  it("/media no sale de su carpeta", async () => {
    expect((await mediaGet("/media/../../package.json")).statusCode).toBe(404);
    expect((await mediaGet("/media/%2e%2e/%2e%2e/package.json")).statusCode).not.toBe(200);
  });
});
