"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
  CATALOGUES,
  type Catalogue,
  type Locale,
  translate,
} from "./catalogue.ts";

interface TranslationsContextValue {
  readonly locale: Locale | "pseudo";
  t(key: string): string;
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
    return { locale, t: (key: string) => translate(catalogue, key) };
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
