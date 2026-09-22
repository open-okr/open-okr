"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  CATALOGUES,
  type Catalogue,
  type Locale,
  type MessageValues,
  translate,
} from "./catalogue.ts";

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
  /** Overrides the resolved catalogue — the pseudo-locale check's own
   * injection seam (`buildPseudoCatalogue()`), not something a real screen
   * passes. */
  readonly catalogueOverride?: Catalogue;
}

export function TranslationsProvider({
  locale,
  children,
  catalogueOverride,
}: TranslationsProviderProps) {
  const value = useMemo<TranslationsContextValue>(() => {
    const catalogue = catalogueOverride ?? CATALOGUES[locale];
    return {
      locale,
      t: (key: string, values?: MessageValues) =>
        translate(catalogue, key, values),
    };
  }, [locale, catalogueOverride]);

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
