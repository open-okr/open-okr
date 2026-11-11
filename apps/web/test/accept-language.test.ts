import { describe, expect, test } from "vitest";
import { acceptedLanguages, browserLocale } from "../lib/accept-language";

// Q-8 (plan 0.8.1): a signed-out page uses the browser's language when the
// product ships it. These are the header's rules, without a request.

const SHIPPED = ["en", "ms"] as const;

describe("acceptedLanguages", () => {
  test("no header, or an empty one, asks for nothing", () => {
    expect(acceptedLanguages(undefined)).toEqual([]);
    expect(acceptedLanguages(null)).toEqual([]);
    expect(acceptedLanguages("")).toEqual([]);
    expect(acceptedLanguages(" , ;q=1")).toEqual([]);
  });

  test("orders by weight, a missing weight counting as 1", () => {
    expect(acceptedLanguages("en;q=0.5, ms-MY, ms;q=0.9, fr;q=0.7")).toEqual([
      "ms-my",
      "ms",
      "fr",
      "en",
    ]);
  });

  test("equal weights keep the order the browser sent", () => {
    expect(acceptedLanguages("fr;q=0.8,en;q=0.8,ms;q=0.8")).toEqual([
      "fr",
      "en",
      "ms",
    ]);
  });

  test("a weight of 0 means not this language", () => {
    expect(acceptedLanguages("ms;q=0, en;q=0.000")).toEqual([]);
  });

  test("reads the browser's own shape, spaces and case included", () => {
    expect(
      acceptedLanguages("MS-my , ms ;Q=0.9,en-US; q=0.8 ,en;q=0.7, *;q=0.1"),
    ).toEqual(["ms-my", "ms", "en-us", "en", "*"]);
  });

  test("drops a malformed part and keeps the rest", () => {
    expect(
      acceptedLanguages(
        "ms;q=high, en;q=1.5, fr;q=0.5000, de;q=-1, <script>, es_ES, it;q=0.4",
      ),
    ).toEqual(["it"]);
  });

  test("ignores parameters other than the weight", () => {
    expect(acceptedLanguages("ms;level=1;q=0.4, en;q=0.3")).toEqual([
      "ms",
      "en",
    ]);
  });

  test("reads no more than 32 parts of a hostile header", () => {
    const header = `${Array.from({ length: 40 }, () => "fr").join(",")},ms`;
    expect(acceptedLanguages(header)).toHaveLength(32);
    expect(acceptedLanguages(header)).not.toContain("ms");
  });
});

describe("browserLocale", () => {
  test("a Malay browser gets Malay, by its region-tagged range too", () => {
    expect(browserLocale("ms", SHIPPED)).toBe("ms");
    expect(browserLocale("ms-MY,ms;q=0.9,en;q=0.8", SHIPPED)).toBe("ms");
  });

  test("the first shipped language by weight wins, not by position", () => {
    expect(browserLocale("en;q=0.6, ms;q=0.9", SHIPPED)).toBe("ms");
    expect(browserLocale("en-GB, ms;q=0.9", SHIPPED)).toBe("en");
  });

  test("passes over a language the product does not ship", () => {
    expect(browserLocale("fr-FR, fr;q=0.9, ms;q=0.5", SHIPPED)).toBe("ms");
  });

  test("nothing shipped, or only anything, is no answer", () => {
    expect(browserLocale("fr, de;q=0.9", SHIPPED)).toBeNull();
    expect(browserLocale("*", SHIPPED)).toBeNull();
    expect(browserLocale(null, SHIPPED)).toBeNull();
  });

  test("a range is matched on its primary language, not a prefix", () => {
    // "msa" is not "ms", and "english" is not a language the product ships.
    expect(browserLocale("msa, english", SHIPPED)).toBeNull();
  });
});
