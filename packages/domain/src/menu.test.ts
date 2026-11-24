import { describe, expect, it } from "vitest";

import { pesos } from "./money";
import {
  fromPriceMinor,
  MenuIssue,
  type MenuProductDoc,
  type PricedProduct,
  priceSelection,
  SelectionError,
  validateMenuProduct,
} from "./menu";

const pizza: PricedProduct = {
  name: "Muzzarella",
  priceMinor: pesos(9_000),
  available: true,
  variants: [
    { id: "chica", name: "Chica", priceMinor: pesos(6_000), available: true },
    { id: "grande", name: "Grande", priceMinor: pesos(9_000), available: true },
    { id: "gigante", name: "Gigante", priceMinor: pesos(12_000), available: false },
  ],
  modifierGroups: [
    {
      id: "masa",
      name: "Masa",
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: "comun", name: "Común", priceDeltaMinor: 0, maxQuantity: 1, available: true },
        { id: "integral", name: "Integral", priceDeltaMinor: pesos(500), maxQuantity: 1, available: true },
      ],
    },
    {
      id: "extras",
      name: "Extras",
      minSelect: 0,
      maxSelect: 3,
      modifiers: [
        { id: "queso", name: "Extra queso", priceDeltaMinor: pesos(800), maxQuantity: 2, available: true },
        { id: "aceitunas", name: "Aceitunas", priceDeltaMinor: pesos(300), maxQuantity: 1, available: false },
      ],
    },
  ],
};

describe("validateMenuProduct", () => {
  it("un producto bien armado no tiene problemas", () => {
    expect(validateMenuProduct(pizza)).toEqual([]);
  });

  it("detecta duplicados sin importar mayúsculas ni espacios", () => {
    const doc: MenuProductDoc = {
      ...pizza,
      variants: [
        { name: "Chica", priceMinor: 100, available: true },
        { name: " chica ", priceMinor: 200, available: true },
      ],
    };
    expect(validateMenuProduct(doc)).toEqual([{ issue: MenuIssue.DUPLICATE_VARIANT, path: "variants.1" }]);
  });

  it("rangos de selección inválidos y mínimos imposibles", () => {
    const doc: MenuProductDoc = {
      name: "Empanadas",
      priceMinor: 100,
      variants: [],
      modifierGroups: [
        { name: "A", minSelect: 2, maxSelect: 1, modifiers: [{ name: "x", priceDeltaMinor: 0, maxQuantity: 1, available: true }] },
        { name: "B", minSelect: 3, maxSelect: 5, modifiers: [{ name: "y", priceDeltaMinor: 0, maxQuantity: 2, available: true }] },
        { name: "C", minSelect: 0, maxSelect: 1, modifiers: [] },
      ],
    };
    expect(validateMenuProduct(doc)).toEqual([
      { issue: MenuIssue.INVALID_SELECT_RANGE, path: "modifierGroups.0" },
      { issue: MenuIssue.MIN_EXCEEDS_OPTIONS, path: "modifierGroups.0" },
      { issue: MenuIssue.MIN_EXCEEDS_OPTIONS, path: "modifierGroups.1" },
      { issue: MenuIssue.GROUP_WITHOUT_OPTIONS, path: "modifierGroups.2" },
    ]);
  });

  it("precios negativos o no enteros", () => {
    const doc: MenuProductDoc = { name: "x", priceMinor: -1, variants: [{ name: "a", priceMinor: 1.5, available: true }], modifierGroups: [] };
    expect(validateMenuProduct(doc).map((p) => p.path)).toEqual(["priceMinor", "variants.0"]);
  });
});

describe("priceSelection", () => {
  it("variante reemplaza el precio; modificadores suman por unidad", () => {
    const r = priceSelection(pizza, {
      variantId: "chica",
      modifiers: [
        { modifierId: "integral", quantity: 1 },
        { modifierId: "queso", quantity: 2 },
      ],
    });
    // 6.000 + 500 + 2 × 800 = 8.100
    expect(r).toEqual({ ok: true, unitPriceMinor: pesos(8_100), variantId: "chica" });
  });

  it("con variantes es obligatorio elegir una, disponible", () => {
    const missing = priceSelection(pizza, { modifiers: [{ modifierId: "comun", quantity: 1 }] });
    expect(missing).toEqual({ ok: false, errors: [{ error: SelectionError.VARIANT_REQUIRED }] });

    const unavailable = priceSelection(pizza, { variantId: "gigante", modifiers: [{ modifierId: "comun", quantity: 1 }] });
    expect(unavailable).toMatchObject({ ok: false, errors: [{ error: SelectionError.VARIANT_UNAVAILABLE }] });
  });

  it("mínimo y máximo por grupo, contando unidades", () => {
    const noMasa = priceSelection(pizza, { variantId: "grande", modifiers: [] });
    expect(noMasa).toMatchObject({ ok: false, errors: [{ error: SelectionError.GROUP_MIN_NOT_MET, ref: "masa" }] });

    const twoMasas = priceSelection(pizza, {
      variantId: "grande",
      modifiers: [
        { modifierId: "comun", quantity: 1 },
        { modifierId: "integral", quantity: 1 },
      ],
    });
    expect(twoMasas).toMatchObject({ ok: false, errors: [{ error: SelectionError.GROUP_MAX_EXCEEDED, ref: "masa" }] });
  });

  it("cantidad por opción, opciones repetidas, desconocidas o sin stock", () => {
    const r = priceSelection(pizza, {
      variantId: "grande",
      modifiers: [
        { modifierId: "comun", quantity: 1 },
        { modifierId: "queso", quantity: 3 },
        { modifierId: "aceitunas", quantity: 1 },
        { modifierId: "inventado", quantity: 1 },
        { modifierId: "comun", quantity: 1 },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.error)).toEqual([
        SelectionError.INVALID_QUANTITY,
        SelectionError.MODIFIER_UNAVAILABLE,
        SelectionError.UNKNOWN_MODIFIER,
        SelectionError.INVALID_QUANTITY,
      ]);
    }
  });

  it("producto pausado no se puede pedir; sin variantes vale el precio del producto", () => {
    const simple: PricedProduct = { name: "Coca 1,5 L", priceMinor: pesos(3_500), available: true, variants: [], modifierGroups: [] };
    expect(priceSelection(simple, { modifiers: [] })).toEqual({ ok: true, unitPriceMinor: pesos(3_500), variantId: null });
    expect(priceSelection({ ...simple, available: false }, { modifiers: [] })).toMatchObject({ ok: false });
  });
});

describe("fromPriceMinor", () => {
  it("precio desde = variante disponible más barata, o el del producto", () => {
    expect(fromPriceMinor(pizza)).toBe(pesos(6_000));
    expect(fromPriceMinor({ priceMinor: 500, variants: [] })).toBe(500);
  });
});
