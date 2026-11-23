"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import de from "../messages/de.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function DeTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="de" catalogue={de} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
