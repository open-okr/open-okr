"use client";

import type { TerminologyOverrides } from "@openokr/method";
import type { ReactNode } from "react";
import zhHans from "../messages/zh-Hans.json";
import { TranslationsProvider } from "../use-translations.tsx";

export function ZhHansTranslationsProvider({
  children,
  renamed,
}: {
  readonly children: ReactNode;
  readonly renamed?: TerminologyOverrides;
  readonly locale?: string;
}) {
  return (
    <TranslationsProvider locale="zh-Hans" catalogue={zhHans} renamed={renamed}>
      {children}
    </TranslationsProvider>
  );
}
