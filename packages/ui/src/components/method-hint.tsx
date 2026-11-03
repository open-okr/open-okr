"use client";

import { Popover } from "@base-ui-components/react/popover";
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "../i18n/use-translations.tsx";

/**
 * A small "i" beside a name the method defines, opening what it means in a
 * sentence or two and a link to the method's own section for the full
 * write-up. A reader should understand a setting without opening METHOD.md
 * first, and still be one click from it.
 *
 * **Hover, tap and keyboard alike.** A tooltip that opens only on hover cannot
 * be read on a phone or reached from the keyboard, so the trigger is a button
 * that opens a popover: a pointer resting on it opens it, a tap or Enter
 * toggles it, Escape closes it, and the pointer can move into it to follow the
 * link. That is WCAG 1.4.13's dismissible, hoverable and persistent.
 *
 * Above a dialog's layer, because the profile comparison opens one inside a
 * dialog.
 */
export function MethodHint({
  name,
  children,
  href,
}: {
  /** What the hint explains, as the screen names it. */
  readonly name: string;
  readonly children: ReactNode;
  /** The method's own section, opened in a new tab. None, no link. */
  readonly href?: string | null;
}) {
  const { t } = useTranslations();
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={200}
        closeDelay={150}
        aria-label={t("methodHint.about", { name })}
        data-testid="method-hint"
        className="inline-flex size-6 flex-none items-center justify-center rounded-full text-ink-4 hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-strong data-popup-open:text-brand-text"
      >
        <Info className="size-3.5" aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} className="z-60">
          <Popover.Popup
            data-testid="method-hint-popup"
            className="max-w-xs rounded-lg border border-line bg-surface p-3 text-sm text-ink-2 shadow-(--shadow-popover) outline-none"
          >
            <Popover.Title className="font-semibold text-ink">
              {name}
            </Popover.Title>
            <div className="mt-1 leading-snug">{children}</div>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block font-semibold text-brand-text underline"
              >
                {t("methodHint.readMore")}
                <span className="sr-only">
                  {" "}
                  {t("methodHint.opensInNewTab")}
                </span>
              </a>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
