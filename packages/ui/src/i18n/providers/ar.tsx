"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import ar from "../messages/ar.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function ArTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="ar" catalogue={ar} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
