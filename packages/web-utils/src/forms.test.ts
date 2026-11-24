import { ApiError } from "@pedilo/api-client";
import { describe, expect, it } from "vitest";

import { errorToFormState, formKey, minorToPesosInput, parsePesosToMinor } from "./forms";

describe("parsePesosToMinor", () => {
  it.each([
    ["1500", 150000],
    ["1500.5", 150050],
    ["1500,50", 150050],
    ["1.500,50", 150050],
    ["1.500", 150000],
    ["$ 2.000", 200000],
    ["0", 0],
  ])("%s → %d centavos", (input, expected) => {
    expect(parsePesosToMinor(input)).toBe(expected);
  });

  it("vacío → undefined; inválido → NaN", () => {
    expect(parsePesosToMinor("  ")).toBeUndefined();
    expect(parsePesosToMinor("abc")).toBeNaN();
    expect(parsePesosToMinor("-5")).toBeNaN();
    expect(parsePesosToMinor("1,234")).toBeNaN();
  });

  it("ida y vuelta con minorToPesosInput", () => {
    expect(minorToPesosInput(150050)).toBe("1500,50");
    expect(minorToPesosInput(150000)).toBe("1500");
    expect(parsePesosToMinor(minorToPesosInput(150005))).toBe(150005);
  });
});

describe("errorToFormState", () => {
  it("separa errores por campo y mensaje general", () => {
    const err = new ApiError(400, "VALIDATION_ERROR", "x", [{ path: "/name", message: "Muy corto" }]);
    expect(errorToFormState(err, { name: "a" })).toEqual({
      message: "Revisá los campos marcados.",
      fieldErrors: { name: "Muy corto" },
      values: { name: "a" },
    });
  });

  it("errores de sesión se propagan", () => {
    expect(() => errorToFormState(new ApiError(401, "UNAUTHORIZED", "x"), {})).toThrow(ApiError);
  });

  it("formKey cambia con los valores", () => {
    expect(formKey(undefined)).toBe("initial");
    expect(formKey({ a: "1" })).not.toBe(formKey({ a: "2" }));
  });
});
