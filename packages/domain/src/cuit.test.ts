import { describe, expect, it } from "vitest";

import { formatCuit, isValidCuit, normalizeCuit } from "./cuit";

describe("CUIT", () => {
  it("acepta CUITs válidos con o sin guiones", () => {
    // Dígito verificador calculado con el algoritmo módulo 11.
    expect(isValidCuit("20-12345678-6")).toBe(true);
    expect(isValidCuit("20123456786")).toBe(true);
    expect(isValidCuit("30-71234567-1")).toBe(true);
  });

  it("rechaza dígito verificador incorrecto, largo o caracteres inválidos", () => {
    expect(isValidCuit("20-12345678-5")).toBe(false);
    expect(isValidCuit("2012345678")).toBe(false);
    expect(isValidCuit("20-1234567A-6")).toBe(false);
  });

  it("normaliza y formatea", () => {
    expect(normalizeCuit("20-12345678-6")).toBe("20123456786");
    expect(formatCuit("20123456786")).toBe("20-12345678-6");
  });
});
