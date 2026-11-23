"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import es from "../messages/es.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function EsTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="es" catalogue={es} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
