"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import en from "../messages/en.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function EnTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="en" catalogue={en} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
