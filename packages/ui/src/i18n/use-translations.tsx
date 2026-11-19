"use client";

import type { TerminologyOverrides } from "@openokr/method";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type Catalogue,
  type Locale,
  type MessageValues,
  translate,
} from "./catalogue.ts";
import en from "./messages/en.json";

const DYNAMIC_LOADERS: Record<string, () => Promise<{ default: Catalogue }>> = {
  ms: () => import("./messages/ms.json"),
};

const catalogueCache = new Map<string, Catalogue>([["en", en]]);
const promiseCache = new Map<string, Promise<Catalogue>>();

function loadCatalogue(locale: string): Promise<Catalogue> {
  const cached = catalogueCache.get(locale);
  if (cached) return Promise.resolve(cached);
  let p = promiseCache.get(locale);
  if (!p) {
    const loader = DYNAMIC_LOADERS[locale];
    if (!loader) return Promise.resolve(en);
    p = loader().then((mod) => {
      catalogueCache.set(locale, mod.default);
      return mod.default;
    });
    promiseCache.set(locale, p);
  }
  return p;
}

if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
  try {
    // Hidden from Turbopack AST static scanner via eval function
    // biome-ignore lint/security/noGlobalEval: test-only dynamic require
    const req = eval("require");
    catalogueCache.set("ms", req("./messages/ms.json") as Catalogue);
  } catch {
    // ignore
  }
}

interface TranslationsContextValue {
  readonly locale: Locale | "pseudo";
  /**
   * The message, with its named holes filled (P6-G22d).
   *
   * `values` is optional because most messages have no holes, and passing
   * one a message does not have throws rather than being ignored.
   */
  t(key: string, values?: MessageValues): string;
}

const TranslationsContext = createContext<TranslationsContextValue | null>(
  null,
);

export interface TranslationsProviderProps {
  readonly locale: Locale;
  readonly children: ReactNode;
  readonly catalogue?: Catalogue;
  /** Overrides the resolved catalogue — the pseudo-locale check's own
   * injection seam (`buildPseudoCatalogue()`), not something a real screen
   * passes. */
  readonly catalogueOverride?: Catalogue;
  /**
   * The workspace's own words for the method's terms (M-14). The root layout
   * resolves them on the server, as it does the locale, so a client component
   * says "Add ambition" exactly where the server said it. Absent before
   * sign-in, where there is no workspace to ask.
   */
  readonly renamed?: TerminologyOverrides;
}

export function TranslationsProvider({
  locale,
  catalogue,
  catalogueOverride,
  children,
  renamed,
}: TranslationsProviderProps) {
  const [dynCatalogue, setDynCatalogue] = useState<Catalogue | undefined>(() =>
    catalogueCache.get(locale),
  );

  useEffect(() => {
    if (catalogueOverride || catalogue) return;
    if (!catalogueCache.has(locale)) {
      loadCatalogue(locale).then((cat) => {
        setDynCatalogue(cat);
      });
    } else if (dynCatalogue !== catalogueCache.get(locale)) {
      setDynCatalogue(catalogueCache.get(locale));
    }
  }, [locale, catalogue, catalogueOverride, dynCatalogue]);

  const value = useMemo<TranslationsContextValue>(() => {
    const activeCatalogue =
      catalogueOverride ??
      catalogue ??
      dynCatalogue ??
      catalogueCache.get(locale) ??
      en;
    return {
      locale,
      t: (key: string, values?: MessageValues) =>
        translate(activeCatalogue, key, values, renamed),
    };
  }, [locale, catalogue, catalogueOverride, dynCatalogue, renamed]);

  return (
    <TranslationsContext.Provider value={value}>
      {children}
    </TranslationsContext.Provider>
  );
}

export function useTranslations(): TranslationsContextValue {
  const context = useContext(TranslationsContext);
  if (!context) {
    throw new Error(
      "useTranslations must be used within a TranslationsProvider.",
    );
  }
  return context;
}
