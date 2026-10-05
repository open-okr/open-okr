"use client";

import { useTranslations } from "@openokr/ui";

/** Why a new objective may not be written here now, and where that changes. */
export interface WritingRefusal {
  readonly reasons: readonly string[];
  readonly links: readonly { readonly href: string; readonly label: string }[];
}

/**
 * What "+ New objective" opens where the workspace holds writing back
 * (P9-T07b-a, design §3, acceptance U8).
 *
 * **Never a dead button.** A button that is disabled or does nothing tells a
 * reader the product is broken; this names the practice's own reason and the
 * place that resolves it: the cycle's phases, or the setting an
 * administrator can change. The reasons are the policy's sentences, the same
 * ones the server gives when it refuses a write.
 */
export function RestrictedWriting({
  refusal,
  onClose,
}: {
  readonly refusal: WritingRefusal;
  readonly onClose: () => void;
}) {
  const { t } = useTranslations();
  return (
    <section
      aria-label={t("okrList.writingHeldBack")}
      data-testid="restricted-writing"
      className="flex max-w-xl flex-col gap-1.5 rounded-control border border-warn-dot bg-warn-bg px-3 py-2 text-xs text-ink-2"
    >
      <p className="font-semibold text-ink">{t("okrList.writingHeldBack")}</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-4">
        {refusal.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <span className="flex flex-wrap items-center gap-3">
        {refusal.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="font-semibold text-brand-text underline"
          >
            {link.label}
          </a>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="rounded-control px-1.5 py-0.5 text-ink-3"
        >
          {t("okrList.close")}
        </button>
      </span>
    </section>
  );
}
