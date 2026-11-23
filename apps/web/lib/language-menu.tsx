"use client";

import { Menu } from "@base-ui-components/react/menu";
import {
  isShippedLocale,
  LOCALES,
  type ShippedLocaleCode,
} from "@openokr/formats";
import { useTranslations } from "@openokr/ui";
import { Check, ChevronDown, Globe } from "lucide-react";
import { menuRowClass } from "../app/menu-row-class.ts";

const SHIPPED = LOCALES.filter((l) => l.shipped);

/**
 * A globe, the name of the language in effect and a caret. Choosing a row
 * applies at once. `value` is the stored choice (`null` or "" follows the
 * workspace when `includeFollowWorkspace` is set), `current` the locale in
 * effect, which names the trigger.
 */
export function LanguageMenu({
  value,
  current,
  includeFollowWorkspace = false,
  onChoose,
  testId,
  pending = false,
  hideNameBelowSm = false,
}: {
  readonly value: ShippedLocaleCode | null;
  readonly current: string;
  readonly includeFollowWorkspace?: boolean;
  readonly onChoose: (next: ShippedLocaleCode | null) => void;
  readonly testId: string;
  readonly pending?: boolean;
  readonly hideNameBelowSm?: boolean;
}) {
  const { t } = useTranslations();
  const active = SHIPPED.find((l) => l.code === current);
  const rowClass = `${menuRowClass} flex items-center justify-between gap-2`;

  return (
    <Menu.Root>
      {/* The name comes from the content, not aria-label, so the visible
       * language is part of it (WCAG 2.5.3, axe label-content-name-mismatch). */}
      <Menu.Trigger
        data-testid={testId}
        className="inline-flex h-7.5 cursor-pointer items-center gap-1.5 rounded-control px-1.5 text-sm text-ink-2 transition-colors duration-fast ease-out hover:text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
      >
        <Globe className="size-4" aria-hidden="true" />
        <span className="sr-only">
          {t("admin.general.generalSettingsForm.language")}{" "}
        </span>
        <span
          lang={active?.code}
          className={hideNameBelowSm ? "hidden sm:inline" : undefined}
        >
          {active ? t(active.endonymKey) : current}
        </span>
        <ChevronDown className="size-4" aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="min-w-45 max-w-72 rounded-lg border border-line bg-surface p-1 shadow-(--shadow-popover)">
            <Menu.RadioGroup
              value={value ?? ""}
              onValueChange={(next) => {
                const code = String(next);
                if (code === "") {
                  onChoose(null);
                } else if (isShippedLocale(code)) {
                  onChoose(code);
                }
              }}
            >
              {includeFollowWorkspace ? (
                <Menu.RadioItem
                  value=""
                  disabled={pending}
                  data-testid={`${testId}-follow`}
                  className={rowClass}
                >
                  {t("appearance.followWorkspace")}
                  <Menu.RadioItemIndicator>
                    <Check className="size-4" aria-hidden="true" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ) : null}
              {SHIPPED.map((l) => (
                <Menu.RadioItem
                  key={l.code}
                  value={l.code}
                  lang={l.code}
                  disabled={pending}
                  data-testid={`${testId}-${l.code}`}
                  className={rowClass}
                >
                  {t(l.endonymKey)}
                  <Menu.RadioItemIndicator>
                    <Check className="size-4" aria-hidden="true" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
