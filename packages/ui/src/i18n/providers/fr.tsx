"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import fr from "../messages/fr.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function FrTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="fr" catalogue={fr} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
