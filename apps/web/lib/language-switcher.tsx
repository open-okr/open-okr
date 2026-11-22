"use client";

import { Menu } from "@base-ui-components/react/menu";
import {
  isShippedLocale,
  LOCALES,
  type ShippedLocaleCode,
} from "@openokr/formats";
import { useTranslations } from "@openokr/ui";
import { Check, Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { menuRowClass } from "../app/menu-row-class.ts";
import { setAppearance } from "./appearance-action.ts";

const SHIPPED = LOCALES.filter((l) => l.shipped);

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
  const { t, locale } = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  function choose(next: ShippedLocaleCode | null) {
    if (next === language) {
      return;
    }
    startTransition(async () => {
      const { error } = await setAppearance({ language: next });
      setProblem(error);
      if (!error) {
        router.refresh();
      }
    });
  }

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("admin.general.generalSettingsForm.language")}
        data-testid="topbar-language"
        className="inline-flex h-7.5 cursor-pointer items-center gap-1.5 rounded-control border border-line bg-surface px-2 text-sm text-ink-2 transition-colors duration-fast ease-out hover:border-line-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <Languages className="size-4" aria-hidden="true" />
        <span className="hidden uppercase sm:inline">{locale}</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="min-w-45 max-w-72 rounded-lg border border-line bg-surface p-1 shadow-(--shadow-popover)">
            <Menu.RadioGroup
              value={language ?? ""}
              onValueChange={(value) => {
                const next = String(value);
                if (next === "") {
                  choose(null);
                } else if (isShippedLocale(next)) {
                  choose(next);
                }
              }}
            >
              <Menu.RadioItem
                value=""
                disabled={pending}
                className={`${menuRowClass} flex items-center justify-between gap-2`}
              >
                {t("appearance.followWorkspace")}
                <Menu.RadioItemIndicator>
                  <Check className="size-4" aria-hidden="true" />
                </Menu.RadioItemIndicator>
              </Menu.RadioItem>
              {SHIPPED.map((l) => (
                <Menu.RadioItem
                  key={l.code}
                  value={l.code}
                  lang={l.code}
                  disabled={pending}
                  className={`${menuRowClass} flex items-center justify-between gap-2`}
                >
                  {t(l.endonymKey)}
                  <Menu.RadioItemIndicator>
                    <Check className="size-4" aria-hidden="true" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            {problem ? (
              <p role="alert" className="px-2.5 py-1.5 text-xs text-danger">
                {problem}
              </p>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
