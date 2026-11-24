import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listApprovedMerchantsInCity } from "../src/modules/merchants/service";
import { bearer, createTestContext, type TestContext } from "./helpers";

let ctx: TestContext;
let admin: string;
let gastroId: string;
let kioscoId: string;
let tostadoId: string;
let galvezId: string;

type Body = Record<string, unknown>;
const req = (method: "GET" | "POST" | "PUT", url: string, token?: string, payload?: Body) =>
  ctx.app.inject({ method, url, ...(token && { headers: bearer(token) }), ...(payload !== undefined && { payload }) });

let cuitSeq = 0;
const CUITS = ["20-12345678-6", "30-71234567-1", "20-11111111-2", "20-22222222-3"];

/** Crea un comercio con una sucursal y, si `approve`, lo deja aprobado. */
async function merchantWith(opts: {
  name: string;
  categoryId: string;
  cityId: string;
  approve: boolean;
  delivery?: { feeMinor: number };
  ranges?: Array<{ weekday: number; opensAt: string; closesAt: string }>;
}) {
  const owner = (await ctx.tokenFor()).token;
  const m = (
    await req("POST", "/v1/merchants", owner, {
      displayName: opts.name,
      legalName: `${opts.name} SRL`,
      taxId: CUITS[cuitSeq++ % CUITS.length],
      categoryId: opts.categoryId,
      contactPhone: "3491 123456",
    })
  ).json();
  const branch = (
    await req("POST", `/v1/merchants/${m.id}/branches`, owner, {
      name: "Centro",
      cityId: opts.cityId,
      addressLine: "San Martín 1",
      acceptsPickup: !opts.delivery,
      acceptsDelivery: Boolean(opts.delivery),
    })
  ).json();
  await req("PUT", `/v1/merchants/${m.id}/branches/${branch.id}/hours`, owner, {
    ranges: opts.ranges ?? [{ weekday: 1, opensAt: "09:00", closesAt: "13:00" }],
  });
  if (opts.delivery) {
    await req("POST", `/v1/merchants/${m.id}/branches/${branch.id}/zones`, owner, { name: "Centro", feeMinor: opts.delivery.feeMinor });
    await req("POST", `/v1/merchants/${m.id}/branches/${branch.id}/zones`, owner, { name: "Lejos", feeMinor: opts.delivery.feeMinor * 2 });
  }
  if (opts.approve) {
    await req("POST", `/v1/merchants/${m.id}/submit`, owner);
    await req("POST", `/v1/admin/merchants/${m.id}/approve`, admin);
  }
  return m as { id: string; slug: string };
}

beforeAll(async () => {
  ctx = await createTestContext();
  admin = await ctx.adminToken();
  tostadoId = (await req("POST", "/v1/admin/cities", admin, { name: "Tostado", province: "Santa Fe" })).json().id;
  galvezId = (await req("POST", "/v1/admin/cities", admin, { name: "Gálvez", province: "Santa Fe" })).json().id;
  gastroId = (await req("POST", "/v1/admin/categories", admin, { kind: "MERCHANT", name: "Gastronomía" })).json().id;
  kioscoId = (await req("POST", "/v1/admin/categories", admin, { kind: "MERCHANT", name: "Kioscos" })).json().id;

  await merchantWith({ name: "Pizzería Don Pepe", categoryId: gastroId, cityId: tostadoId, approve: true, delivery: { feeMinor: 150000 } });
  await merchantWith({
    name: "Kiosco El Sol",
    categoryId: kioscoId,
    cityId: tostadoId,
    approve: true,
    // Viernes 20:00 a sábado 02:00.
    ranges: [{ weekday: 5, opensAt: "20:00", closesAt: "02:00" }],
  });
  await merchantWith({ name: "Borrador SA", categoryId: gastroId, cityId: tostadoId, approve: false });
  await merchantWith({ name: "Café de Gálvez", categoryId: gastroId, cityId: galvezId, approve: true });
});
afterAll(() => ctx.close());

describe("comercios públicos de una ciudad", () => {
  it("lista solo aprobados con sucursal en la ciudad, con datos de entrega", async () => {
    const res = await req("GET", "/v1/public/cities/tostado/merchants");
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<Record<string, unknown>>;
    expect(list.map((m) => m.displayName).sort()).toEqual(["Kiosco El Sol", "Pizzería Don Pepe"]);
    const pizzeria = list.find((m) => m.displayName === "Pizzería Don Pepe");
    expect(pizzeria).toMatchObject({ acceptsDelivery: true, acceptsPickup: false, minDeliveryFeeMinor: 150000 });
    expect(typeof pizzeria?.openNow).toBe("boolean");
    expect(list.find((m) => m.displayName === "Kiosco El Sol")).toMatchObject({
      acceptsPickup: true,
      acceptsDelivery: false,
      minDeliveryFeeMinor: null,
    });
  });

  it("cada ciudad muestra sus propios comercios", async () => {
    const res = await req("GET", "/v1/public/cities/galvez/merchants");
    expect(res.json().map((m: { displayName: string }) => m.displayName)).toEqual(["Café de Gálvez"]);
  });

  it("filtra por rubro", async () => {
    const res = await req("GET", `/v1/public/cities/tostado/merchants?categoryId=${kioscoId}`);
    expect(res.json().map((m: { displayName: string }) => m.displayName)).toEqual(["Kiosco El Sol"]);
  });

  it("ciudad inexistente o inactiva → 404", async () => {
    expect((await req("GET", "/v1/public/cities/no-existe/merchants")).statusCode).toBe(404);
  });

  it("abiertos primero, según la hora local de la sucursal (incluye horario que cruza la medianoche)", async () => {
    // Sábado 2026-11-28 01:30 en Argentina (04:30 UTC): el kiosco abre viernes 20:00–02:00.
    const saturdayNight = await listApprovedMerchantsInCity(ctx.db, "tostado", { now: new Date("2026-11-28T04:30:00Z") });
    expect(saturdayNight?.map((m) => [m.displayName, m.openNow])).toEqual([
      ["Kiosco El Sol", true],
      ["Pizzería Don Pepe", false],
    ]);
    // Lunes 2026-11-30 10:00 en Argentina (13:00 UTC): abre la pizzería (lunes 09–13).
    const mondayMorning = await listApprovedMerchantsInCity(ctx.db, "tostado", { now: new Date("2026-11-30T13:00:00Z") });
    expect(mondayMorning?.map((m) => [m.displayName, m.openNow])).toEqual([
      ["Pizzería Don Pepe", true],
      ["Kiosco El Sol", false],
    ]);
  });

  it("el menú público informa si cada sucursal está abierta", async () => {
    const res = await req("GET", "/v1/public/merchants/pizzeria-don-pepe");
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().merchant.branches[0].openNow).toBe("boolean");
  });
});
