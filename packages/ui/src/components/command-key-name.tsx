"use client";

import { useTranslations } from "../i18n/use-translations.tsx";

/**
 * The spoken name of the Command key. A client component on purpose: `Kbd`
 * is rendered from server components and must stay hook-free, and a server
 * component may render a client one.
 */
export function CommandKeyName() {
  const { t } = useTranslations();
  return <span className="sr-only">{t("kbd.command")} </span>;
}
