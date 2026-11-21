"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import pt from "../messages/pt.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function PtTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="pt" catalogue={pt} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
