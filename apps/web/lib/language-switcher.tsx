"use client";

import type { ShippedLocaleCode } from "@openokr/formats";
import { useToast, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setAppearance } from "./appearance-action.ts";
import { LanguageMenu } from "./language-menu.tsx";

/**
 * The topbar's language switcher. It saves the choice on the member, so the
 * resolution order stays member, workspace, instance, English. `null` follows
 * the workspace.
 */
export function LanguageSwitcher({
  language,
}: {
  readonly language: ShippedLocaleCode | null;
}) {
  const { locale } = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // A refusal is shown as a toast: the menu has closed by the time the
  // server answers, so text inside it would never be seen.
  const { show } = useToast();

  function choose(next: ShippedLocaleCode | null) {
    if (next === language) {
      return;
    }
    startTransition(async () => {
      const { error } = await setAppearance({ language: next });
      if (error) {
        show({ tone: "bad", message: error, source: "topbar-language" });
        return;
      }
      router.refresh();
    });
  }

  return (
    <LanguageMenu
      value={language}
      current={locale}
      includeFollowWorkspace
      onChoose={choose}
      testId="topbar-language"
      pending={pending}
      hideNameBelowSm
    />
  );
}
