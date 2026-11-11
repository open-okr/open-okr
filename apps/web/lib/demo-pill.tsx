"use client";

import { Chip, Tooltip, useTranslations } from "@openokr/ui";

/**
 * Says an instance is a demonstration (plan 0.8.0 D1).
 *
 * Drawn on sign-in and in the top bar whenever `OPENOKR_DEMO` is `on`, the
 * variable the demo deployment already sets. Before this the only sign was
 * the persona panel on sign-in, hidden when no persona was listed, and
 * nothing on a signed-in screen said the instance is rebuilt on a schedule.
 *
 * **One word to see, one sentence to hear.** The chip reads "Demo"; hovering
 * or focusing it shows the sentence, and a screen reader reads the sentence
 * from the hidden text, once. The span is focusable so a keyboard reaches the
 * tooltip; it does nothing when pressed, because there is nothing to do.
 */
export function DemoPill() {
  const { t } = useTranslations();
  const explain = t("shell.demo.explain");
  return (
    <Tooltip label={explain} side="bottom">
      <span
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the tooltip is the only way a keyboard reads the sentence a sighted mouse user sees
        tabIndex={0}
        role="note"
        className="inline-flex flex-none rounded-full focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
        data-testid="demo-pill"
      >
        <Chip tone="info">
          <span aria-hidden="true">{t("shell.demo.label")}</span>
          <span className="sr-only">{explain}</span>
        </Chip>
      </span>
    </Tooltip>
  );
}
