/**
 * The words the mails use, in each language the product ships
 * (docs/design/email-templates.md §10, docs/design/languages.md §13).
 *
 * Words now live in the server message catalogues under `packages/core/src/i18n/messages/`.
 * This file preserves typed exports and resolution functions.
 */
import {
  isShippedLocale,
  SHIPPED_LOCALES,
  type ShippedLocaleCode,
} from "@openokr/formats";
import { getServerCatalogue, serverTranslate } from "../i18n/catalogue.ts";
import en from "../i18n/messages/en.json" with { type: "json" };

export type MailLocale = ShippedLocaleCode;

export type MailWordKey = keyof typeof en;

const WORDS: Readonly<
  Record<MailLocale, Readonly<Record<MailWordKey, string>>>
> = Object.fromEntries(
  SHIPPED_LOCALES.map((locale) => [locale, getServerCatalogue(locale)]),
) as Record<MailLocale, Readonly<Record<MailWordKey, string>>>;

/** The locale a stored language reads as, with English as the fallback. */
export function mailLocale(language: string | null | undefined): MailLocale {
  return isShippedLocale(language) ? language : "en";
}

export type MailWords = (
  key: MailWordKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

export function mailWords(locale: MailLocale): MailWords {
  return (key, values) => serverTranslate(locale, key, values);
}

/** Both tables, for the test that holds them to the same keys and holes. */
export const MAIL_WORD_TABLES = WORDS;
