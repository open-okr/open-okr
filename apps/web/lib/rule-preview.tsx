"use client";

import { PreviewCard } from "@base-ui-components/react/preview-card";
import { describeRule, methodSectionAnchor } from "@openokr/method";
import { useTranslations } from "@openokr/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { methodDocumentUrl } from "./app-version";

/** Catalogue keys for what kind of rule it is, one per kind. */
const KIND_LABELS = {
  objective: "rulePreview.objective",
  key_result: "rulePreview.keyResult",
  alignment: "rulePreview.alignment",
  cycle: "rulePreview.cycle",
  trigger: "rulePreview.trigger",
} as const;

/**
 * A link to a rule's own page that previews the rule on hover (UIUX-PLAN §4,
 * method hint).
 *
 * Every verdict and nudge names its rule by key, "KR-3" or a trigger's title,
 * and a reader could not tell what "KR-3" asks without opening it. Resting on
 * the link now says so in place: the rule's name, what kind it is, what it
 * looks for or when it fires and who hears it, all from `describeRule`, and a
 * link to the METHOD.md section a check comes from.
 *
 * **A preview card, not a popover**, because the trigger is already a link
 * that does something: a click or tap still opens the rule's page, which says
 * everything the preview says and more. The preview is a shortcut for a
 * pointer or keyboard focus, never the only way to the words.
 */
export function RulePreview({
  ruleKey,
  className,
  children,
}: {
  readonly ruleKey: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  const { t } = useTranslations();
  const href = `/method/${ruleKey}`;
  const rule = describeRule(ruleKey);
  if (rule === null) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  const anchor = rule.section ? methodSectionAnchor(rule.section) : null;

  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={300}
        closeDelay={150}
        render={<Link href={href} className={className} />}
      >
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={6} className="z-60">
          <PreviewCard.Popup
            data-testid="rule-preview"
            className="flex max-w-xs flex-col gap-1.5 rounded-lg border border-line bg-surface p-3 text-sm text-ink-2 shadow-(--shadow-popover)"
          >
            <div>
              <p className="font-semibold text-ink">{rule.name}</p>
              <p className="text-xs text-ink-3">{t(KIND_LABELS[rule.kind])}</p>
            </div>
            {rule.looksFor.length > 0 ? (
              <div>
                <p>{t("rulePreview.looksFor")}</p>
                <ul className="list-disc pl-4">
                  {rule.looksFor.map((condition) => (
                    <li key={condition}>{condition}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {rule.fires ? (
              <p>{t("rulePreview.fires", { fires: rule.fires })}</p>
            ) : null}
            {rule.recipient ? (
              <p>{t("rulePreview.recipient", { recipient: rule.recipient })}</p>
            ) : null}
            {anchor ? (
              <a
                href={methodDocumentUrl(anchor)}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand-text underline"
              >
                {t("methodHint.readMore")}
                <span className="sr-only">
                  {" "}
                  {t("methodHint.opensInNewTab")}
                </span>
              </a>
            ) : null}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
