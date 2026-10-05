"use client";

import { Tabs } from "@base-ui-components/react/tabs";
import { Bar, Button, Chip, useTranslations } from "@openokr/ui";
import { useState } from "react";
import { ActionForm } from "../cycle/action-form.tsx";
import { applyFinding, dismissFinding } from "./alignment-actions.ts";

/**
 * The diagram's alignment panel (P9-T09b, from the studio's S-16 panel).
 *
 * Two tabs, two questions about the same cascade: Health asks what is wrong
 * with its shape, the score and the structural gaps the engine found; Review
 * asks what the Coach thinks about the words, and is empty until a provider
 * is configured, which it says rather than hiding the tab. The studio's third
 * tab, the details of one goal, is the drawer now.
 */

interface AlignmentFinding {
  readonly id: string;
  readonly ruleKey: string | null;
  readonly severity: string;
  readonly kind: string;
  readonly reason: string;
  readonly source: string;
  readonly subjectGoalId: string | null;
  readonly subjectGoalTitle: string | null;
}

export interface AlignmentReading {
  /** The share aligned or standing alone, as a percentage (METHOD.md §5.2). */
  readonly score: number | null;
  readonly band: "healthy" | "watch" | "gap" | null;
  readonly threshold: number;
  readonly watchThreshold: number;
  readonly anchored: boolean;
  readonly measured: number;
  readonly counted: number;
  /** What the share did not count, cited by a check or not (P9-T16b-a). */
  readonly uncounted: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  readonly findings: readonly AlignmentFinding[];
}

/** How each band reads, the same three tones a KPI corridor uses. */
const BAND_TEXT: Readonly<Record<string, string>> = {
  healthy: "text-ok",
  watch: "text-warn",
  gap: "text-bad",
};

/**
 * Gaps drawn before "Show all". A cycle of three hundred objectives can hold
 * two hundred findings, and drawing each with its own form is what took the
 * diagram past its one-second budget (design §7).
 */
const FIRST_FINDINGS = 12;

const SEVERITY_TONE: Readonly<Record<string, "bad" | "warn" | "neutral">> = {
  high: "bad",
  medium: "warn",
  low: "neutral",
};

export function AlignmentPanel({
  alignment,
  canEdit,
  onOpen,
}: {
  readonly alignment: AlignmentReading;
  readonly canEdit: boolean;
  /** Opens a finding's objective in the drawer. */
  readonly onOpen: (goalId: string) => void;
}) {
  const { t } = useTranslations();
  const [all, setAll] = useState(false);
  const [allUncounted, setAllUncounted] = useState(false);
  const uncounted = allUncounted
    ? alignment.uncounted
    : alignment.uncounted.slice(0, FIRST_FINDINGS);
  const structural = alignment.findings.filter(
    (finding) => finding.source === "engine",
  );
  const shown = all ? structural : structural.slice(0, FIRST_FINDINGS);
  const semantic = alignment.findings.filter(
    (finding) => finding.source === "coach",
  );

  return (
    <aside
      aria-label={t("okrDiagram.alignmentPanel")}
      data-testid="alignment-panel"
      className="flex w-full flex-none flex-col rounded-lg border border-line bg-surface lg:w-80"
    >
      <Tabs.Root defaultValue="health" className="flex flex-col">
        <Tabs.List className="flex gap-1 border-b border-line px-3">
          <Tabs.Tab
            value="health"
            className="-mb-px border-b-2 border-transparent px-2 py-2 text-xs font-semibold text-ink-3 hover:text-ink data-active:border-brand data-active:text-ink"
          >
            {t("okrDiagram.health")}
          </Tabs.Tab>
          <Tabs.Tab
            value="review"
            className="-mb-px border-b-2 border-transparent px-2 py-2 text-xs font-semibold text-ink-3 hover:text-ink data-active:border-brand data-active:text-ink"
          >
            {t("okrDiagram.review")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="health" className="flex flex-col gap-2.5 p-3">
          {alignment.score === null ? (
            <p className="text-sm text-ink-3">
              {t("goals.studio.studio.noScoreThereIs")}
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-4">
                  {t("goals.studio.studio.alignmentHealth")}
                </span>
                <span
                  data-testid="alignment-share"
                  className={`text-lg font-bold tabular-nums ${
                    BAND_TEXT[alignment.band ?? ""] ?? "text-ink"
                  }`}
                >
                  {alignment.score}%
                </span>
              </div>
              <Bar
                value={alignment.score}
                label={t("goals.studio.studio.alignmentHealth")}
                className="h-1.5"
              />
              <p className="text-xs text-ink-3">
                {t("goals.studio.studio.alignmentCounted", {
                  counted: alignment.counted,
                  measured: alignment.measured,
                })}
              </p>
              <p data-testid="alignment-band" className="text-xs text-ink-3">
                {bandSentence(t, alignment)}
              </p>
            </>
          )}
          {alignment.uncounted.length > 0 ? (
            <section
              data-testid="alignment-uncounted"
              className="flex flex-col gap-1"
            >
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                {t("okrDiagram.notCounted", {
                  count: String(alignment.uncounted.length),
                })}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {uncounted.map((goal) => (
                  <li key={goal.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(goal.id)}
                      className="text-left text-xs text-brand-text underline"
                    >
                      {goal.title}
                    </button>
                  </li>
                ))}
              </ul>
              {alignment.uncounted.length > FIRST_FINDINGS ? (
                <button
                  type="button"
                  onClick={() => setAllUncounted((current) => !current)}
                  className="self-start text-xs font-semibold text-brand-text hover:underline"
                >
                  {allUncounted
                    ? t("okrDiagram.showFewerFindings")
                    : t("okrDiagram.showAllNotCounted", {
                        count: String(alignment.uncounted.length),
                      })}
                </button>
              ) : null}
            </section>
          ) : null}
          {structural.length === 0 ? (
            <p className="text-xs text-ink-3">
              {t("goals.studio.studio.noStructuralGaps")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shown.map((finding) => (
                <li
                  key={finding.id}
                  className="flex flex-col gap-1 rounded-md border border-line p-2"
                >
                  <span className="flex items-center justify-between gap-2">
                    <Chip tone={SEVERITY_TONE[finding.severity] ?? "neutral"}>
                      {finding.ruleKey ?? finding.kind}
                    </Chip>
                    {canEdit ? (
                      <ActionForm action={dismissFinding}>
                        <input
                          type="hidden"
                          name="findingId"
                          value={finding.id}
                        />
                        <Button type="submit" size="sm">
                          {t("common.dismiss")}
                        </Button>
                      </ActionForm>
                    ) : null}
                  </span>
                  <span className="text-xs text-ink-2">{finding.reason}</span>
                  <Subject finding={finding} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          )}
          {structural.length > FIRST_FINDINGS ? (
            <button
              type="button"
              onClick={() => setAll((current) => !current)}
              className="self-start text-xs font-semibold text-brand-text hover:underline"
            >
              {all
                ? t("okrDiagram.showFewerFindings")
                : t("okrDiagram.showAllFindings", {
                    count: String(structural.length),
                  })}
            </button>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel value="review" className="flex flex-col gap-2.5 p-3">
          {semantic.length === 0 ? (
            <>
              <p className="text-sm text-ink-3">{t("common.nothingHereYet")}</p>
              <p className="text-xs text-ink-4">
                {t("goals.studio.studio.thisTabHoldsThe")}
              </p>
            </>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {semantic.map((finding) => (
                <li
                  key={finding.id}
                  className="flex flex-col gap-1 rounded-md border border-line p-2"
                >
                  <Chip tone={SEVERITY_TONE[finding.severity] ?? "neutral"}>
                    {finding.kind}
                  </Chip>
                  <span className="text-xs text-ink-2">{finding.reason}</span>
                  <Subject finding={finding} onOpen={onOpen} />
                  {canEdit ? (
                    <span className="flex flex-wrap gap-1.5">
                      {/* §5.3 offers the click only where the fix is
                          mechanical, so only a relink gets one. A conflict or
                          a gap has a conversation to have rather than a
                          button to press, and the action refuses them by name
                          if anybody tries. */}
                      {finding.kind === "relink" ? (
                        <ActionForm action={applyFinding}>
                          <input
                            type="hidden"
                            name="findingId"
                            value={finding.id}
                          />
                          <Button type="submit" size="sm">
                            {t("goals.studio.studio.reParent")}
                          </Button>
                        </ActionForm>
                      ) : null}
                      <ActionForm action={dismissFinding}>
                        <input
                          type="hidden"
                          name="findingId"
                          value={finding.id}
                        />
                        <Button type="submit" size="sm">
                          {t("common.dismiss")}
                        </Button>
                      </ActionForm>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}

/**
 * What the band means, in §5.2's words. The missing anchor comes first,
 * because it is why a perfect share can still read as a gap.
 */
function bandSentence(
  t: ReturnType<typeof useTranslations>["t"],
  alignment: AlignmentReading,
): string {
  if (!alignment.anchored) {
    return t("goals.studio.studio.alignmentNoAnchor");
  }
  if (alignment.band === "healthy") {
    return t("goals.studio.studio.atOrAboveHealthy", {
      threshold: alignment.threshold,
    });
  }
  return alignment.band === "watch"
    ? t("goals.studio.studio.alignmentWatch", {
        watch: alignment.watchThreshold,
        threshold: alignment.threshold,
      })
    : t("goals.studio.studio.alignmentGap", {
        watch: alignment.watchThreshold,
      });
}

/** The objective a finding is about, opened in the drawer beside it. */
function Subject({
  finding,
  onOpen,
}: {
  readonly finding: AlignmentFinding;
  readonly onOpen: (goalId: string) => void;
}) {
  const { t } = useTranslations();
  if (!finding.subjectGoalId) {
    return (
      <span className="text-xs text-ink-4">
        {t("goals.studio.studio.noGoalCausedThis")}
      </span>
    );
  }
  const goalId = finding.subjectGoalId;
  return (
    <button
      type="button"
      onClick={() => onOpen(goalId)}
      className="self-start text-left text-xs text-brand-text underline"
    >
      {finding.subjectGoalTitle ?? t("workMap.openTheGoal")}
    </button>
  );
}
