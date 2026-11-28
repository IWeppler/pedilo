import type { Category, CategoryKind, CommissionCategory } from "@pedilo/api-client";
import { FLAT_PRICING, formatARS } from "@pedilo/domain";

export const KIND_LABELS: Record<CategoryKind, string> = {
  MERCHANT: "Rubros de comercio",
  PRODUCT: "Categorías de producto",
};

export const KIND_SINGULAR: Record<CategoryKind, string> = {
  MERCHANT: "rubro",
  PRODUCT: "categoría de producto",
};

/** Con la concordancia de género correcta: "Nuevo rubro" / "Nueva categoría de producto". */
export const KIND_NEW: Record<CategoryKind, string> = {
  MERCHANT: "Nuevo rubro",
  PRODUCT: "Nueva categoría de producto",
};

const COMMISSION_NAMES: Record<CommissionCategory, string> = {
  GASTRONOMY: "Gastronomía",
  KIOSK: "Kioscos",
  SUPERMARKET: "Supermercados",
  ELECTRONICS: "Electrónica",
  ENTREPRENEUR: "Emprendedores",
};

export const COMMISSION_OPTIONS = (Object.keys(COMMISSION_NAMES) as CommissionCategory[]).map((value) => ({
  value,
  label: commissionLabel(value),
}));

/** "Supermercados", o "Supermercados (tope $ 5.000,00 por pedido)" si el pricing vigente tiene tope (ADR 0033: hoy no). */
export function commissionLabel(value: CommissionCategory): string {
  const cap = FLAT_PRICING.capsByCategory[value];
  return cap === null ? COMMISSION_NAMES[value] : `${COMMISSION_NAMES[value]} (tope ${formatARS(cap)} por pedido)`;
}

export function commissionShortLabel(value: CommissionCategory | null): string {
  return value ? COMMISSION_NAMES[value] : "—";
}

export function parseKind(value: unknown): CategoryKind {
  return value === "PRODUCT" ? "PRODUCT" : "MERCHANT";
}

export interface CategoryNode {
  category: Category;
  depth: number;
}

/**
 * Lista plana (ya ordenada por la API) → filas en orden de árbol con su profundidad.
 * Una categoría cuyo padre no está en la lista se muestra como raíz.
 */
export function toTreeRows(categories: Category[]): CategoryNode[] {
  const ids = new Set(categories.map((c) => c.id));
  const children = new Map<string | null, Category[]>();
  for (const c of categories) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const rows: CategoryNode[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      rows.push({ category: c, depth });
      if (depth < 20) visit(c.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

/** Ids de una categoría y todos sus descendientes (no pueden ser su nuevo padre). */
export function selfAndDescendants(categories: Category[], id: string): Set<string> {
  const result = new Set<string>([id]);
  let added = true;
  while (added) {
    added = false;
    for (const c of categories) {
      if (c.parentId && result.has(c.parentId) && !result.has(c.id)) {
        result.add(c.id);
        added = true;
      }
    }
  }
  return result;
}
