/**
 * The locale registry (docs/design/languages.md §1.1, §2 L-D1, §3).
 *
 * One pure registry shared by browser and server: code, Intl tag, direction,
 * endonym key, font family, and shipped flag.
 *
 * Pure: no dependencies, no external imports, no messages in it.
 */

export const LOCALE_CODES = [
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

export type LocaleCode = (typeof LOCALE_CODES)[number];

export type LocaleDirection = "ltr" | "rtl";

export interface LocaleDefinition {
  readonly code: LocaleCode;
  readonly intlTag: string;
  readonly direction: LocaleDirection;
  readonly endonymKey: string;
  readonly fontFamily: string;
  readonly shipped: boolean;
  readonly languageName: string;
}

export const LOCALES = [
  {
    code: "en",
    intlTag: "en-GB",
    direction: "ltr",
    endonymKey: "appearance.english",
    fontFamily: "Geist",
    shipped: true,
    languageName: "English",
  },
  {
    code: "ms",
    intlTag: "ms-MY",
    direction: "ltr",
    endonymKey: "appearance.bahasaMelayu",
    fontFamily: "Geist",
    shipped: true,
    languageName: "Malay (Bahasa Melayu)",
  },
  {
    code: "zh-Hans",
    intlTag: "zh-Hans",
    direction: "ltr",
    endonymKey: "appearance.simplifiedChinese",
    fontFamily: "Geist, then Noto Sans SC",
    shipped: true,
    languageName: "Simplified Chinese (简体中文)",
  },
  {
    code: "es",
    intlTag: "es",
    direction: "ltr",
    endonymKey: "appearance.spanish",
    fontFamily: "Geist",
    shipped: true,
    languageName: "Spanish (Español)",
  },
  {
    code: "ar",
    intlTag: "ar-u-nu-latn",
    direction: "rtl",
    endonymKey: "appearance.arabic",
    fontFamily: "Noto Sans Arabic, then Geist",
    shipped: true,
    languageName: "Arabic (العربية)",
  },
  {
    code: "de",
    intlTag: "de",
    direction: "ltr",
    endonymKey: "appearance.german",
    fontFamily: "Geist",
    shipped: true,
    languageName: "German (Deutsch)",
  },
  {
    code: "pt",
    intlTag: "pt",
    direction: "ltr",
    endonymKey: "appearance.portuguese",
    fontFamily: "Geist",
    shipped: true,
    languageName: "Portuguese (Português)",
  },
  {
    code: "fr",
    intlTag: "fr",
    direction: "ltr",
    endonymKey: "appearance.french",
    fontFamily: "Geist",
    shipped: true,
    languageName: "French (Français)",
  },
  {
    code: "it",
    intlTag: "it",
    direction: "ltr",
    endonymKey: "appearance.italian",
    fontFamily: "Geist",
    shipped: true,
    languageName: "Italian (Italiano)",
  },
  {
    code: "id",
    intlTag: "id",
    direction: "ltr",
    endonymKey: "appearance.indonesian",
    fontFamily: "Geist",
    shipped: true,
    languageName: "Indonesian (Bahasa Indonesia)",
  },
] as const satisfies readonly LocaleDefinition[];

export type ShippedLocaleCode = Extract<
  (typeof LOCALES)[number],
  { shipped: true }
>["code"];

export const SHIPPED_LOCALES: readonly ShippedLocaleCode[] = LOCALES.filter(
  (l) => l.shipped,
).map((l) => l.code);

const LOCALE_BY_CODE = new Map<string, LocaleDefinition>(
  LOCALES.map((l) => [l.code, l]),
);

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && LOCALE_BY_CODE.has(value);
}

export function isShippedLocale(value: unknown): value is ShippedLocaleCode {
  if (typeof value !== "string") {
    return false;
  }
  const def = LOCALE_BY_CODE.get(value);
  return def ? def.shipped : false;
}

export function getLocaleDefinition(
  code: string | null | undefined,
): LocaleDefinition | undefined {
  if (!code) {
    return undefined;
  }
  return LOCALE_BY_CODE.get(code);
}

export function intlTagFor(code: string | null | undefined): string {
  const def = getLocaleDefinition(code);
  return def ? def.intlTag : "en-GB";
}

export function directionFor(code: string | null | undefined): LocaleDirection {
  const def = getLocaleDefinition(code);
  return def ? def.direction : "ltr";
}

export function languageName(code: string | null | undefined): string {
  const def = getLocaleDefinition(code);
  return def ? def.languageName : "English";
}
