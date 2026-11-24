/**
 * Productos del menú de un comercio: variantes y modificadores. SPEC §4.1 punto 4, US-201.
 *
 * - Si un producto tiene variantes, el cliente elige exactamente una y su precio REEMPLAZA
 *   al del producto ("Chica $5.000 / Grande $8.000"). Sin variantes, vale el precio del producto.
 * - Los grupos de modificadores SUMAN un recargo ("Extra queso +$800"), con mínimo y máximo de
 *   elecciones por grupo y un máximo de unidades por opción.
 *
 * Todo importe en centavos. Estas funciones son la fuente única de las reglas: la API valida
 * con ellas al guardar y al recalcular precios en el checkout; las apps solo para mostrar.
 */

export interface MenuVariant {
  id?: string | undefined;
  name: string;
  priceMinor: number;
  available: boolean;
}

export interface MenuModifier {
  id?: string | undefined;
  name: string;
  priceDeltaMinor: number;
  /** Cuántas unidades de esta opción se pueden elegir (p. ej. "extra queso" hasta 2). */
  maxQuantity: number;
  available: boolean;
}

export interface MenuModifierGroup {
  id?: string | undefined;
  name: string;
  /** 0 = opcional. ≥ 1 = obligatorio elegir al menos esa cantidad. */
  minSelect: number;
  maxSelect: number;
  modifiers: MenuModifier[];
}

export interface MenuProductDoc {
  name: string;
  priceMinor: number;
  variants: MenuVariant[];
  modifierGroups: MenuModifierGroup[];
}

export const MenuLimits = {
  MAX_VARIANTS: 20,
  MAX_GROUPS: 10,
  MAX_MODIFIERS_PER_GROUP: 30,
  MAX_PRICE_MINOR: 100_000_000, // $1.000.000
  MAX_OPTION_QUANTITY: 10,
} as const;

export const MenuIssue = {
  DUPLICATE_VARIANT: "DUPLICATE_VARIANT",
  DUPLICATE_GROUP: "DUPLICATE_GROUP",
  DUPLICATE_MODIFIER: "DUPLICATE_MODIFIER",
  INVALID_PRICE: "INVALID_PRICE",
  INVALID_SELECT_RANGE: "INVALID_SELECT_RANGE",
  GROUP_WITHOUT_OPTIONS: "GROUP_WITHOUT_OPTIONS",
  MIN_EXCEEDS_OPTIONS: "MIN_EXCEEDS_OPTIONS",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  TOO_MANY_ITEMS: "TOO_MANY_ITEMS",
} as const;
export type MenuIssue = (typeof MenuIssue)[keyof typeof MenuIssue];

export interface MenuProblem {
  issue: MenuIssue;
  /** Ruta al elemento con problema, p. ej. "modifierGroups.1.modifiers.0". */
  path: string;
}

const validPrice = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MenuLimits.MAX_PRICE_MINOR;
const norm = (s: string) => s.trim().toLocaleLowerCase("es");

/** Reglas de un producto completo. Lista vacía = válido. */
export function validateMenuProduct(doc: MenuProductDoc): MenuProblem[] {
  const problems: MenuProblem[] = [];
  if (!validPrice(doc.priceMinor)) problems.push({ issue: MenuIssue.INVALID_PRICE, path: "priceMinor" });

  if (doc.variants.length > MenuLimits.MAX_VARIANTS) problems.push({ issue: MenuIssue.TOO_MANY_ITEMS, path: "variants" });
  const variantNames = new Set<string>();
  doc.variants.forEach((v, i) => {
    if (!validPrice(v.priceMinor)) problems.push({ issue: MenuIssue.INVALID_PRICE, path: `variants.${i}` });
    if (variantNames.has(norm(v.name))) problems.push({ issue: MenuIssue.DUPLICATE_VARIANT, path: `variants.${i}` });
    variantNames.add(norm(v.name));
  });

  if (doc.modifierGroups.length > MenuLimits.MAX_GROUPS) {
    problems.push({ issue: MenuIssue.TOO_MANY_ITEMS, path: "modifierGroups" });
  }
  const groupNames = new Set<string>();
  doc.modifierGroups.forEach((g, gi) => {
    const base = `modifierGroups.${gi}`;
    if (groupNames.has(norm(g.name))) problems.push({ issue: MenuIssue.DUPLICATE_GROUP, path: base });
    groupNames.add(norm(g.name));

    if (g.modifiers.length === 0) problems.push({ issue: MenuIssue.GROUP_WITHOUT_OPTIONS, path: base });
    if (g.modifiers.length > MenuLimits.MAX_MODIFIERS_PER_GROUP) {
      problems.push({ issue: MenuIssue.TOO_MANY_ITEMS, path: `${base}.modifiers` });
    }
    const intOk = Number.isInteger(g.minSelect) && Number.isInteger(g.maxSelect);
    if (!intOk || g.minSelect < 0 || g.maxSelect < 1 || g.minSelect > g.maxSelect) {
      problems.push({ issue: MenuIssue.INVALID_SELECT_RANGE, path: base });
    }

    const names = new Set<string>();
    let capacity = 0;
    g.modifiers.forEach((m, mi) => {
      const path = `${base}.modifiers.${mi}`;
      if (!Number.isSafeInteger(m.priceDeltaMinor) || m.priceDeltaMinor < 0 || m.priceDeltaMinor > MenuLimits.MAX_PRICE_MINOR) {
        problems.push({ issue: MenuIssue.INVALID_PRICE, path });
      }
      if (!Number.isInteger(m.maxQuantity) || m.maxQuantity < 1 || m.maxQuantity > MenuLimits.MAX_OPTION_QUANTITY) {
        problems.push({ issue: MenuIssue.INVALID_QUANTITY, path });
      }
      if (names.has(norm(m.name))) problems.push({ issue: MenuIssue.DUPLICATE_MODIFIER, path });
      names.add(norm(m.name));
      capacity += Math.max(0, Math.trunc(m.maxQuantity));
    });
    // Un mínimo imposible de cumplir con las opciones cargadas bloquearía el producto.
    if (g.modifiers.length > 0 && intOk && g.minSelect > capacity) {
      problems.push({ issue: MenuIssue.MIN_EXCEEDS_OPTIONS, path: base });
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Selección del cliente y precio
// ---------------------------------------------------------------------------

export interface PricedProduct extends MenuProductDoc {
  available: boolean;
  variants: Array<MenuVariant & { id: string }>;
  modifierGroups: Array<MenuModifierGroup & { id: string; modifiers: Array<MenuModifier & { id: string }> }>;
}

export interface ProductSelection {
  variantId?: string | null | undefined;
  /** Opciones elegidas: id del modificador y cantidad. */
  modifiers: Array<{ modifierId: string; quantity: number }>;
}

export const SelectionError = {
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  VARIANT_REQUIRED: "VARIANT_REQUIRED",
  UNKNOWN_VARIANT: "UNKNOWN_VARIANT",
  VARIANT_UNAVAILABLE: "VARIANT_UNAVAILABLE",
  UNKNOWN_MODIFIER: "UNKNOWN_MODIFIER",
  MODIFIER_UNAVAILABLE: "MODIFIER_UNAVAILABLE",
  INVALID_QUANTITY: "INVALID_QUANTITY",
  GROUP_MIN_NOT_MET: "GROUP_MIN_NOT_MET",
  GROUP_MAX_EXCEEDED: "GROUP_MAX_EXCEEDED",
} as const;
export type SelectionError = (typeof SelectionError)[keyof typeof SelectionError];

export type SelectionResult =
  | { ok: true; unitPriceMinor: number; variantId: string | null }
  | { ok: false; errors: Array<{ error: SelectionError; ref?: string }> };

/**
 * Valida la selección del cliente y calcula el precio unitario.
 * Cada unidad de un modificador cuenta como una elección para el mínimo/máximo del grupo.
 */
export function priceSelection(product: PricedProduct, selection: ProductSelection): SelectionResult {
  const errors: Array<{ error: SelectionError; ref?: string }> = [];
  if (!product.available) errors.push({ error: SelectionError.PRODUCT_UNAVAILABLE });

  let base = product.priceMinor;
  let variantId: string | null = null;
  if (product.variants.length > 0) {
    if (!selection.variantId) {
      errors.push({ error: SelectionError.VARIANT_REQUIRED });
    } else {
      const variant = product.variants.find((v) => v.id === selection.variantId);
      if (!variant) errors.push({ error: SelectionError.UNKNOWN_VARIANT, ref: selection.variantId });
      else {
        if (!variant.available) errors.push({ error: SelectionError.VARIANT_UNAVAILABLE, ref: variant.id });
        base = variant.priceMinor;
        variantId = variant.id;
      }
    }
  }

  const byModifier = new Map<string, { group: PricedProduct["modifierGroups"][number]; modifier: MenuModifier & { id: string } }>();
  for (const group of product.modifierGroups) for (const modifier of group.modifiers) byModifier.set(modifier.id, { group, modifier });

  const countPerGroup = new Map<string, number>();
  let extras = 0;
  const seen = new Set<string>();
  for (const pick of selection.modifiers) {
    const found = byModifier.get(pick.modifierId);
    if (!found) {
      errors.push({ error: SelectionError.UNKNOWN_MODIFIER, ref: pick.modifierId });
      continue;
    }
    const { group, modifier } = found;
    if (!Number.isInteger(pick.quantity) || pick.quantity < 1 || pick.quantity > modifier.maxQuantity || seen.has(modifier.id)) {
      errors.push({ error: SelectionError.INVALID_QUANTITY, ref: modifier.id });
      continue;
    }
    seen.add(modifier.id);
    if (!modifier.available) errors.push({ error: SelectionError.MODIFIER_UNAVAILABLE, ref: modifier.id });
    countPerGroup.set(group.id, (countPerGroup.get(group.id) ?? 0) + pick.quantity);
    extras += modifier.priceDeltaMinor * pick.quantity;
  }

  for (const group of product.modifierGroups) {
    const count = countPerGroup.get(group.id) ?? 0;
    if (count < group.minSelect) errors.push({ error: SelectionError.GROUP_MIN_NOT_MET, ref: group.id });
    if (count > group.maxSelect) errors.push({ error: SelectionError.GROUP_MAX_EXCEEDED, ref: group.id });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, unitPriceMinor: base + extras, variantId };
}

/** Precio "desde" para mostrar en listados: la variante disponible más barata, o el precio del producto. */
export function fromPriceMinor(product: Pick<MenuProductDoc, "priceMinor" | "variants">): number {
  const available = product.variants.filter((v) => v.available);
  return available.length ? Math.min(...available.map((v) => v.priceMinor)) : product.priceMinor;
}
