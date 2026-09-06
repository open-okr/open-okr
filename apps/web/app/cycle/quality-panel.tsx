"use client";

import {
  applyStrictness,
  evaluateKeyResults,
  evaluateObjective,
  type KeyResultInput,
  type QualityStatus,
  type ResolvedThresholds,
} from "@openokr/method";
import Link from "next/link";
import { useMemo } from "react";
import type { CoachKeyResult, CoachObjective } from "./draft-coach.tsx";

/**
 * Every open issue across the drafted set, grouped by objective
 * (P4-T02c, screen S-09, mockup `03-draft-coach`).
 *
 * The coach beside each objective answers "what is wrong with this one". This
 * answers "what is left across all of them", which is the question a
 * facilitator has at the end of a drafting session and cannot answer by
 * scrolling.
 *
 * **Every issue links at the field that fixes it**, not at the goal. An issue
 * list that lands somebody at the top of a page has moved the work of finding
 * the row from the panel to the reader. Key result checks link at the row by
 * its id; objective checks link at the goal, because the title, the cycle and
 * the two roles all live in its header.
 *
 * It re-evaluates rather than reading the stored flags. The stored flags are
 * ids without a status, so a panel built from them could say a check fired but
 * not whether it blocks, and could not move when strictness changes without a
 * round trip. Same package, same thresholds, same answer as the server: the
 * P4-T02a suite asserts the two agree.
 */

const ORDER: Record<QualityStatus, number> = {
  fail: 0,
  warn: 1,
  todo: 2,
  pass: 3,
};

const TONE: Record<QualityStatus, string> = {
  fail: "bg-bad-bg text-bad",
  warn: "bg-warn-bg text-warn",
  todo: "bg-raised text-ink-3",
  pass: "bg-ok-bg text-ok",
};

export interface PanelObjective {
  readonly objective: CoachObjective;
  readonly keyResults: readonly CoachKeyResult[];
}

export function QualityPanel({
  set,
  thresholds,
  checkTitles,
}: {
  readonly set: readonly PanelObjective[];
  readonly thresholds: ResolvedThresholds;
  readonly checkTitles: readonly {
    readonly id: string;
    readonly title: string;
  }[];
}) {
  const titles = useMemo(
    () => new Map(checkTitles.map((entry) => [entry.id, entry.title])),
    [checkTitles],
  );

  const groups = useMemo(() => {
    const strictness = thresholds["quality.coachStrictness"];
    return set.map((entry) => {
      const rows: KeyResultInput[] = entry.keyResults.map((row) => ({
        text: row.title,
        baseline: row.baseline,
        target: row.target,
        dueOn: row.dueOn,
        ownerId: row.ownerId,
        indicatorType: row.indicatorType,
        direction: row.direction,
        confidence: row.confidence,
      }));

      const objective = applyStrictness(
        evaluateObjective(entry.objective, thresholds),
        strictness,
      );
      const keyResults = applyStrictness(
        evaluateKeyResults({ keyResults: rows }, thresholds),
        strictness,
      );

      const issues = [
        ...objective
          .filter((verdict) => verdict.status !== "pass")
          .map((verdict) => ({
            id: verdict.id,
            status: verdict.status,
            prompt: verdict.prompt,
            href: `/goals/${entry.objective.id}`,
            where: "the objective",
          })),
        ...keyResults
          .filter((verdict) => verdict.status !== "pass")
          .flatMap((verdict) =>
            verdict.keyResults.length === 0
              ? [
                  {
                    id: verdict.id,
                    status: verdict.status,
                    prompt: verdict.prompt,
                    href: `/goals/${entry.objective.id}`,
                    where: "the set",
                  },
                ]
              : verdict.keyResults.map((index) => {
                  const row = entry.keyResults[index];
                  return {
                    id: verdict.id,
                    status: verdict.status,
                    prompt: verdict.prompt,
                    href: row
                      ? `/goals/${entry.objective.id}#kr-${row.id}`
                      : `/goals/${entry.objective.id}`,
                    where: row?.title ?? "a key result",
                  };
                }),
          ),
      ].sort((a, b) => ORDER[a.status] - ORDER[b.status]);

      return { objective: entry.objective, issues };
    });
  }, [set, thresholds]);

  const total = groups.reduce((sum, group) => sum + group.issues.length, 0);
  const mustFix = groups.reduce(
    (sum, group) =>
      sum + group.issues.filter((issue) => issue.status === "fail").length,
    0,
  );

  return (
    // Named, so it is a landmark a screen reader can jump to and a test can
    // scope to. A `section` with no accessible name has no role at all.
    <section
      aria-labelledby="quality-panel-heading"
      className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="quality-panel-heading" className="text-sm font-bold text-ink">
          Quality panel
        </h2>
        {mustFix > 0 ? (
          <span className="rounded-full bg-bad-bg px-2 py-0.5 text-xs font-semibold text-bad">
            {mustFix} must fix
          </span>
        ) : null}
      </div>

      {set.length === 0 ? (
        <p className="text-xs text-ink-3">
          Nothing drafted yet, so there is nothing to check. The panel fills as
          objectives arrive.
        </p>
      ) : total === 0 ? (
        <p className="text-xs text-ok">
          Every check passes across {set.length} objective
          {set.length === 1 ? "" : "s"}. Nothing here is blocking a publication.
        </p>
      ) : (
        <p className="text-xs text-ink-3">
          {total} issue{total === 1 ? "" : "s"} across{" "}
          {groups.filter((g) => g.issues.length > 0).length} objective
          {groups.filter((g) => g.issues.length > 0).length === 1 ? "" : "s"}.
          Each one links at the field that fixes it.
        </p>
      )}

      {groups
        .filter((group) => group.issues.length > 0)
        .map((group) => (
          <div key={group.objective.id} className="flex flex-col gap-1.5">
            <h3 className="truncate text-xs font-bold uppercase tracking-wide text-ink-3">
              {group.objective.title}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {group.issues.map((issue) => (
                <li key={`${issue.id}-${issue.href}-${issue.where}`}>
                  <Link
                    href={issue.href}
                    className="flex flex-col gap-0.5 rounded-md border border-line p-2 hover:border-brand"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[0.65rem] font-bold ${TONE[issue.status]}`}
                      >
                        {issue.id}
                      </span>
                      <span className="truncate text-xs font-semibold text-ink">
                        {titles.get(issue.id) ?? issue.id}
                      </span>
                    </span>
                    <span className="text-xs text-ink-3">{issue.prompt}</span>
                    <span className="text-xs text-ink-4">In {issue.where}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
