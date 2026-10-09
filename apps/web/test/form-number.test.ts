import { describe, expect, it } from "vitest";
import { formNumber } from "../lib/form-number";

/** UAT BUG-003: an empty field is missing, never a zero nobody typed. */
describe("formNumber", () => {
  const form = (value: string | null) => {
    const data = new FormData();
    if (value !== null) {
      data.set("field", value);
    }
    return data;
  };

  it("reads a typed number, zero included", () => {
    expect(formNumber(form("40"), "field")).toBe(40);
    expect(formNumber(form("0"), "field")).toBe(0);
    expect(formNumber(form("-2.5"), "field")).toBe(-2.5);
  });

  it("reads an empty, blank or absent field as missing", () => {
    expect(formNumber(form(""), "field")).toBeNaN();
    expect(formNumber(form("   "), "field")).toBeNaN();
    expect(formNumber(form(null), "field")).toBeNaN();
  });

  it("reads text as not a number", () => {
    expect(formNumber(form("abc"), "field")).toBeNaN();
  });
});
