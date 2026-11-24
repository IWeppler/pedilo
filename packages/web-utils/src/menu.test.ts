import { describe, expect, it } from "vitest";

import { describeMenuPath, describeMenuProblems } from "./menu";

const doc = {
  variants: [{ name: "Chica" }, { name: "chica" }],
  modifierGroups: [{ name: "Extras", modifiers: [{ name: "Extra queso" }] }],
};

describe("describeMenuPath", () => {
  it("nombra el elemento con problema", () => {
    expect(describeMenuPath("variants.1", doc)).toBe("Variante «chica»");
    expect(describeMenuPath("modifierGroups.0", doc)).toBe("Grupo «Extras»");
    expect(describeMenuPath("modifierGroups.0.modifiers.0", doc)).toBe("Grupo «Extras», opción «Extra queso»");
    expect(describeMenuPath("priceMinor", doc)).toBe("Precio del producto");
  });

  it("arma un mensaje legible", () => {
    expect(describeMenuProblems([{ issue: "DUPLICATE_VARIANT", path: "variants.1" }], doc)).toBe(
      "Variante «chica»: nombre de variante repetido.",
    );
  });
});
