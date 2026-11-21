"use client";

import { type Locale, TranslationsProvider } from "@openokr/ui";
import { type ComponentProps, type ComponentType, lazy } from "react";

type ProviderProps = ComponentProps<typeof TranslationsProvider>;

// Static client references from the root layout group the providers in one
// chunk. Keep the extra catalogues behind locale-specific imports (§4.2).
const LOCALE_PROVIDERS: Partial<Record<Locale, ComponentType<ProviderProps>>> =
  {
    "zh-Hans": lazy(() =>
      import("@openokr/ui/providers/zh-Hans").then((module) => ({
        default: module.ZhHansTranslationsProvider,
      })),
    ),
    es: lazy(() =>
      import("@openokr/ui/providers/es").then((module) => ({
        default: module.EsTranslationsProvider,
      })),
    ),
  };

export function LocaleProvider(props: ProviderProps) {
  const Provider = LOCALE_PROVIDERS[props.locale] ?? TranslationsProvider;
  return <Provider {...props} />;
}
