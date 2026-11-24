/** Textos para los problemas de validación de productos (MenuIssue de @pedilo/domain). */
export const MENU_ISSUE_LABELS: Record<string, string> = {
  DUPLICATE_VARIANT: "nombre de variante repetido",
  DUPLICATE_GROUP: "nombre de grupo repetido",
  DUPLICATE_MODIFIER: "opción repetida en el grupo",
  INVALID_PRICE: "precio inválido",
  INVALID_SELECT_RANGE: "el mínimo no puede ser mayor que el máximo, y el máximo tiene que ser al menos 1",
  GROUP_WITHOUT_OPTIONS: "el grupo no tiene opciones",
  MIN_EXCEEDS_OPTIONS: "el mínimo es mayor que las opciones disponibles",
  INVALID_QUANTITY: "cantidad máxima inválida",
  TOO_MANY_ITEMS: "demasiados elementos",
};

interface NamedDoc {
  variants: Array<{ name: string }>;
  modifierGroups: Array<{ name: string; modifiers: Array<{ name: string }> }>;
}

/** "modifierGroups.1.modifiers.0" → "Grupo «Extras», opción «Extra queso»". */
export function describeMenuPath(path: string, doc: NamedDoc): string {
  const parts = path.split(".");
  if (parts[0] === "priceMinor") return "Precio del producto";
  if (parts[0] === "variants") {
    const v = parts[1] !== undefined ? doc.variants[Number(parts[1])] : undefined;
    return v ? `Variante «${v.name}»` : "Variantes";
  }
  if (parts[0] === "modifierGroups") {
    const g = parts[1] !== undefined ? doc.modifierGroups[Number(parts[1])] : undefined;
    if (!g) return "Grupos de opciones";
    const m = parts[3] !== undefined ? g.modifiers[Number(parts[3])] : undefined;
    return m ? `Grupo «${g.name}», opción «${m.name}»` : `Grupo «${g.name}»`;
  }
  return "Producto";
}

export function describeMenuProblems(problems: Array<{ issue: string; path: string }>, doc: NamedDoc): string {
  return problems
    .map((p) => `${describeMenuPath(p.path, doc)}: ${MENU_ISSUE_LABELS[p.issue] ?? p.issue}`)
    .join(". ")
    .concat(".");
}
