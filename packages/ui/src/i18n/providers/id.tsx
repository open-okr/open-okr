"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import id from "../messages/id.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function IdTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="id" catalogue={id} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
