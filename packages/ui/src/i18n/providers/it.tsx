"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import it from "../messages/it.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function ItTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="it" catalogue={it} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
