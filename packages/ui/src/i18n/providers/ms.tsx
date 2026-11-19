"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import ms from "../messages/ms.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function MsTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="ms" catalogue={ms} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
