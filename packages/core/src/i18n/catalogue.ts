/**
 * Server message catalogue and loader (languages §13, 0.10.0 S6).
 *
 * Provides synchronous message resolution for mail, notifications, nudges,
 * and server-rendered texts, free of any UI dependency.
 */
import {
  type Catalogue,
  isShippedLocale,
  type MessageValues,
  translate,
} from "@openokr/formats";
import ar from "./messages/ar.json" with { type: "json" };
import en from "./messages/en.json" with { type: "json" };
import es from "./messages/es.json" with { type: "json" };
import ms from "./messages/ms.json" with { type: "json" };
import pt from "./messages/pt.json" with { type: "json" };
import zhHans from "./messages/zh-Hans.json" with { type: "json" };

const SERVER_CATALOGUES: Readonly<Record<string, Catalogue>> = {
  en,
  ms,
  "zh-Hans": zhHans,
  es,
  ar,
  pt,
};

export function getServerCatalogue(locale: string): Catalogue {
  if (isShippedLocale(locale) && SERVER_CATALOGUES[locale]) {
    return SERVER_CATALOGUES[locale];
  }
  return SERVER_CATALOGUES.en ?? en;
}

export function serverTranslate(
  locale: string,
  key: string,
  values?: MessageValues,
): string {
  const catalogue = getServerCatalogue(locale);
  return translate(catalogue, key, values, undefined, locale);
}
