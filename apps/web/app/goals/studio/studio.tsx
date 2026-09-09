"use client";

import {
  Bar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useState, useTransition } from "react";
import { ActionForm } from "../../cycle/action-form.tsx";
import { applyFinding, dismissFinding, linkGoals } from "./actions.ts";
import { Canvas, type StudioEdge, type StudioNode } from "./canvas.tsx";

/**
 * The studio's shell: the canvas and the three-tab panel (S-16, P3-T10).
 *
 * The panel's three tabs are three different questions about the same cascade,
 * which is why they are tabs rather than three cards. Details asks "what is this
 * node", health asks "what is wrong with the shape", review asks "what does the
 * Coach think about the words". The third is empty until a provider is
 * configured, and says so rather than being hidden, because a tab that appears
 * later is a feature nobody discovers. §5.3's review arrived at P4-T06b-b and
 * its findings are decided from here.
 */

export interface Finding {
  readonly id: string;
  readonly ruleKey: string | null;
  readonly severity: string;
  readonly kind: string;
  readonly reason: string;
  readonly source: string;
  readonly subjectGoalId: string | null;
  readonly subjectGoalTitle: string | null;
}

type Tab = "details" | "health" | "review";

const SEVERITY_TONE: Readonly<Record<string, "bad" | "warn" | "neutral">> = {
  high: "bad",
  medium: "warn",
  low: "neutral",
};

export function Studio({
  nodes,
  edges,
  findings,
  score,
  healthy,
  threshold,
  canEdit,
}: {
  readonly nodes: readonly StudioNode[];
  readonly edges: readonly StudioEdge[];
  readonly findings: readonly Finding[];
  readonly score: number | null;
  readonly healthy: boolean | null;
  readonly threshold: number;
  readonly canEdit: boolean;
}) {
  const { t } = useTranslations();

  const [selectedId, setSelectedId] = useState<string | null>(
    nodes[0]?.id ?? null,
  );
  const [tab, setTab] = useState<Tab>("details");
  const [linkMode, setLinkMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const structural = findings.filter((finding) => finding.source === "engine");
  const semantic = findings.filter((finding) => finding.source === "coach");

  return (
    <div className="flex flex-col gap-3.5 lg:flex-row">
      <div className="min-w-0 flex-1">
        <Canvas
          nodes={nodes}
          edges={edges}
          selectedId={selectedId}
          onSelect={setSelectedId}
          linkMode={linkMode && canEdit}
          onLink={(from, to) => {
            setError(null);
            startTransition(async () => {
              const state = await linkGoals(from, to);
              if (state.error) {
                setError(state.error);
              }
              setLinkMode(false);
            });
          }}
        />
        {canEdit ? (
          <div className="mt-2 flex items-center gap-2.5">
            <Button
              type="button"
              variant={linkMode ? "primary" : "default"}
              onClick={() => {
                setError(null);
                setLinkMode((value) => !value);
              }}
            >
              {linkMode ? "Cancel link" : "Link two goals"}
            </Button>
            <span className="text-xs text-ink-3">
              {pending
                ? "Saving the link…"
                : "A dependency is two-way by meaning, so either end may add it."}
            </span>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="mt-2 rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
          >
            {error}
          </p>
        ) : null}
      </div>

      <div className="w-full flex-none lg:w-88">
        <Card>
          <CardHeader className="gap-1">
            {(["details", "health", "review"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setTab(entry)}
                aria-current={tab === entry ? "true" : undefined}
                className={
                  tab === entry
                    ? "rounded-md bg-brand-weak px-2 py-0.5 text-xs font-semibold text-brand-text capitalize"
                    : "rounded-md px-2 py-0.5 text-xs font-medium text-ink-3 capitalize hover:bg-raised"
                }
              >
                {entry}
              </button>
            ))}
          </CardHeader>
          <CardBody className="flex flex-col gap-2.5">
            {tab === "details" ? (
              selected ? (
                <>
                  <a
                    href={`/goals/${selected.id}`}
                    className="text-sm font-semibold text-ink hover:underline"
                  >
                    {selected.title}
                  </a>
                  <dl className="flex flex-col gap-1 text-xs">
                    <Row label="Level" value={selected.level} />
                    <Row label="Owner" value={selected.owner} />
                    <Row
                      label="Health"
                      value={selected.health.replace("_", " ")}
                    />
                    <Row
                      label="Key results"
                      value={String(selected.keyResultCount)}
                    />
                    <Row
                      label="Dependencies"
                      value={String(selected.dependencyCount)}
                    />
                    <Row
                      label="Aligned"
                      value={selected.unaligned ? "no parent" : "yes"}
                    />
                  </dl>
                  <span className="flex items-center gap-2">
                    <Bar
                      value={selected.progressPct}
                      className="h-1.5 flex-1"
                    />
                    <span className="text-xs font-semibold text-ink-3">
                      {Math.round(selected.progressPct)}%
                    </span>
                  </span>
                  <p className="text-xs text-ink-4">
                    {t("goals.studio.studio.reParentingAndEditing")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-ink-3">
                  {t("goals.studio.studio.selectAGoalOn")}
                </p>
              )
            ) : null}

            {tab === "health" ? (
              <>
                {score === null ? (
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
                        className={
                          healthy
                            ? "text-lg font-bold text-ok"
                            : "text-lg font-bold text-warn"
                        }
                      >
                        {score}
                      </span>
                    </div>
                    <Bar value={score} className="h-1.5" />
                    <p className="text-xs text-ink-3">
                      {healthy
                        ? `At or above ${threshold}, which METHOD.md §5.2 calls healthy.`
                        : `Below ${threshold}. Each gap below opens the goal that caused it.`}
                    </p>
                  </>
                )}
                {structural.length === 0 ? (
                  <p className="text-xs text-ink-3">
                    {t("goals.studio.studio.noStructuralGaps")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {structural.map((finding) => (
                      <li
                        key={finding.id}
                        className="flex flex-col gap-1 rounded-md border border-line p-2"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <Chip
                            tone={SEVERITY_TONE[finding.severity] ?? "neutral"}
                          >
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
                        <span className="text-xs text-ink-2">
                          {finding.reason}
                        </span>
                        {finding.subjectGoalId ? (
                          <a
                            href={`/goals/${finding.subjectGoalId}`}
                            className="text-xs text-brand-text underline"
                          >
                            {finding.subjectGoalTitle ?? "Open the goal"}
                          </a>
                        ) : (
                          <span className="text-xs text-ink-4">
                            {t("goals.studio.studio.noGoalCausedThis")}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}

            {tab === "review" ? (
              semantic.length === 0 ? (
                <>
                  <p className="text-sm text-ink-3">
                    {t("common.nothingHereYet")}
                  </p>
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
                      <span className="text-xs text-ink-2">
                        {finding.reason}
                      </span>
                      {canEdit ? (
                        <span className="flex flex-wrap gap-1.5">
                          {/* §5.3 offers the click only where the fix is
                              mechanical, so only a relink gets one. A conflict
                              or a gap has a conversation to have rather than a
                              button to press, and the action refuses them by
                              name if anybody tries. */}
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
              )
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-4">{label}</dt>
      <dd className="truncate font-medium text-ink-2">{value}</dd>
    </div>
  );
}
