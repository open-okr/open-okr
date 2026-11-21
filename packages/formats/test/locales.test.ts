import { describe, expect, it } from "vitest";
import {
  directionFor,
  intlTagFor,
  isLocaleCode,
  isShippedLocale,
  LOCALE_CODES,
  LOCALES,
  type LocaleCode,
  type LocaleDirection,
  languageName,
  SHIPPED_LOCALES,
} from "../src/locales.ts";

describe("locales registry", () => {
  it("defines exactly ten codes", () => {
    expect(LOCALE_CODES).toEqual([
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
    ]);
    expect(LOCALES).toHaveLength(10);
  });

  it("assigns Intl tags and directions exactly as languages §3", () => {
    const expected: Record<
      LocaleCode,
      { intlTag: string; direction: LocaleDirection }
    > = {
      en: { intlTag: "en-GB", direction: "ltr" },
      ms: { intlTag: "ms-MY", direction: "ltr" },
      "zh-Hans": { intlTag: "zh-Hans", direction: "ltr" },
      es: { intlTag: "es", direction: "ltr" },
      ar: { intlTag: "ar-u-nu-latn", direction: "rtl" },
      de: { intlTag: "de", direction: "ltr" },
      pt: { intlTag: "pt", direction: "ltr" },
      fr: { intlTag: "fr", direction: "ltr" },
      it: { intlTag: "it", direction: "ltr" },
      id: { intlTag: "id", direction: "ltr" },
    };

    for (const [code, { intlTag, direction }] of Object.entries(expected)) {
      const loc = LOCALES.find((l) => l.code === code);
      expect(loc, `locale entry for ${code}`).toBeDefined();
      expect(loc?.intlTag).toBe(intlTag);
      expect(loc?.direction).toBe(direction);
      expect(intlTagFor(code)).toBe(intlTag);
      expect(directionFor(code)).toBe(direction);
    }
  });

  it("ar resolves to ar-u-nu-latn", () => {
    expect(intlTagFor("ar")).toBe("ar-u-nu-latn");
    expect(directionFor("ar")).toBe("rtl");
  });

  it("shipped is true for en and ms only", () => {
    expect(SHIPPED_LOCALES).toEqual([
      "en",
      "ms",
      "zh-Hans",
      "es",
      "ar",
      "de",
      "pt",
    ]);
    for (const loc of LOCALES) {
      if (
        loc.code === "en" ||
        loc.code === "ms" ||
        loc.code === "zh-Hans" ||
        loc.code === "es" ||
        loc.code === "ar" ||
        loc.code === "de" ||
        loc.code === "pt"
      ) {
        expect(loc.shipped, `${loc.code} should be shipped`).toBe(true);
        expect(isShippedLocale(loc.code)).toBe(true);
      } else {
        expect(loc.shipped, `${loc.code} should not be shipped`).toBe(false);
        expect(isShippedLocale(loc.code)).toBe(false);
      }
    }
  });

  it("recognizes valid locale codes and rejects unknown ones", () => {
    expect(isLocaleCode("en")).toBe(true);
    expect(isLocaleCode("zh-Hans")).toBe(true);
    expect(isLocaleCode("zh")).toBe(false);
    expect(isLocaleCode("fr-FR")).toBe(false);
    expect(isLocaleCode(null)).toBe(false);
    expect(isLocaleCode(undefined)).toBe(false);
  });

  it("provides English language names for the drafter", () => {
    expect(languageName("en")).toBe("English");
    expect(languageName("ms")).toBe("Malay (Bahasa Melayu)");
    expect(languageName("de")).toBe("German (Deutsch)");
    expect(languageName("zh-Hans")).toBe("Simplified Chinese (简体中文)");
    expect(languageName("ar")).toBe("Arabic (العربية)");
    expect(languageName("es")).toBe("Spanish (Español)");
    expect(languageName("pt")).toBe("Portuguese (Português)");
    expect(languageName("fr")).toBe("French (Français)");
    expect(languageName("it")).toBe("Italian (Italiano)");
    expect(languageName("id")).toBe("Indonesian (Bahasa Indonesia)");
  });
});
