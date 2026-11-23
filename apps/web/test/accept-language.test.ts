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

  describe("languages §8.2 browser matching table", () => {
    const WITH_ALL = [
      "en",
      "ms",
      "zh-Hans",
      "es",
      "ar",
      "de",
      "pt",
      "fr",
      "it",
      "id",
    ] as const;

    test("exact match with a shipped code, compared case-insensitively", () => {
      expect(browserLocale("zh-hans", WITH_ALL)).toBe("zh-Hans");
      expect(browserLocale("ZH-HANS", WITH_ALL)).toBe("zh-Hans");
      expect(browserLocale("ES", WITH_ALL)).toBe("es");
      expect(browserLocale("Ms", WITH_ALL)).toBe("ms");
    });

    test("zh, zh-cn, zh-sg, zh-my, zh-hans, zh-hans-* map to zh-Hans", () => {
      for (const range of [
        "zh",
        "zh-cn",
        "zh-sg",
        "zh-my",
        "zh-hans",
        "zh-hans-cn",
        "zh-Hans-SG",
      ]) {
        expect(browserLocale(range, WITH_ALL), range).toBe("zh-Hans");
      }
    });

    test("zh-tw, zh-hk, zh-mo, zh-hant, zh-hant-* are not zh-Hans and try the next range", () => {
      for (const range of [
        "zh-tw",
        "zh-hk",
        "zh-mo",
        "zh-hant",
        "zh-hant-tw",
        "zh-Hant-HK",
      ]) {
        expect(browserLocale(`${range}, en;q=0.5`, WITH_ALL), range).toBe("en");
        expect(browserLocale(range, WITH_ALL), range).toBeNull();
      }
    });

    test("in (the old code for Indonesian) maps to id", () => {
      expect(browserLocale("in", WITH_ALL)).toBe("id");
      expect(browserLocale("in-ID, in;q=0.9", WITH_ALL)).toBe("id");
    });

    test("any other range falls back to its primary subtag if shipped", () => {
      expect(browserLocale("pt-BR", WITH_ALL)).toBe("pt");
      expect(browserLocale("pt-PT", WITH_ALL)).toBe("pt");
      expect(browserLocale("es-419", WITH_ALL)).toBe("es");
      expect(browserLocale("ar-EG", WITH_ALL)).toBe("ar");
      expect(browserLocale("de-AT", WITH_ALL)).toBe("de");
      expect(browserLocale("fr-CA", WITH_ALL)).toBe("fr");
      expect(browserLocale("it-CH", WITH_ALL)).toBe("it");
    });

    test("* matches nothing", () => {
      expect(browserLocale("*", WITH_ALL)).toBeNull();
      expect(browserLocale("*, en;q=0.1", WITH_ALL)).toBe("en");
    });

    test("AC-3: Accept-Language: zh-CN,zh;q=0.9,en;q=0.8 renders in zh-Hans", () => {
      const shippedWithZh = ["en", "ms", "zh-Hans"] as const;
      expect(browserLocale("zh-CN,zh;q=0.9,en;q=0.8", shippedWithZh)).toBe(
        "zh-Hans",
      );
    });

    test("AC-4: Accept-Language: zh-TW,zh-Hant;q=0.9,en;q=0.8 renders in English, never Simplified Chinese", () => {
      const shippedWithZh = ["en", "ms", "zh-Hans"] as const;
      expect(browserLocale("zh-TW,zh-Hant;q=0.9,en;q=0.8", shippedWithZh)).toBe(
        "en",
      );
    });
  });
});
