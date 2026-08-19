"use client";

import {
  applyStrictness,
  evaluateKeyResults,
  evaluateObjective,
  examplesFor,
  type KeyResultInput,
  type QualityStatus,
  type QualityVerdict,
  type ResolvedThresholds,
  strengthScore,
} from "@openokr/method";
import { useMemo, useState } from "react";
import {
  RuleVerdict,
  type RuleVerdictView,
  StrengthMeter,
} from "./rule-verdict.tsx";

/**
 * The Draft Coach: §4's checks, live as somebody types (P4-T02b, screen S-09).
 *
 * **The same package the server uses, not a copy of it.** `packages/method` is
 * pure by design so this component and the Operation that stores the score run
 * identical code. A second implementation for the browser is how a product ends
 * up coaching one thing inline and refusing another on save.
 *
 * The resolved thresholds arrive as a prop rather than being read here. They are
 * per workspace, they include the strictness, and a client cannot see the
 * settings row. Passing them down keeps the browser and the server judging by
 * the same numbers.
 *
 * Evaluation runs on every keystroke with no debounce. It is pure arithmetic
 * over a handful of word lists, and the task's budget is sixteen milliseconds
 * for a five-key-result objective, which the unit test measures. Debouncing
 * would be the wrong fix for a cost that is not there.
 */

export interface CoachKeyResult {
  readonly id: string;
  readonly title: string;
  readonly baseline: number;
  readonly target: number;
  readonly dueOn: string | null;
  readonly ownerId: string | null;
  readonly indicatorType: "leading" | "lagging";
  readonly direction: "increase" | "reduce" | "maintain" | "move";
  readonly confidence: number | null;
}

export interface CoachObjective {
  readonly id: string;
  readonly title: string;
  readonly hasCycle: boolean;
  readonly hasTimeframe: boolean;
  readonly championId: string | null;
  readonly reviewerId: string | null;
  readonly objectivesInUnit: number;
  readonly level: "company" | "department" | "team" | "individual";
}

const viewOf = (
  verdict: QualityVerdict,
  titles: ReadonlyMap<string, string>,
  offenders: readonly string[],
): RuleVerdictView => ({
  id: verdict.id,
  title: titles.get(verdict.id) ?? verdict.id,
  status: verdict.status,
  prompt: verdict.prompt,
  condition: verdict.condition,
  examples: examplesFor(verdict.id),
  offenders,
});

export function DraftCoach({
  objective,
  keyResults,
  thresholds,
  checkTitles,
}: {
  readonly objective: CoachObjective;
  readonly keyResults: readonly CoachKeyResult[];
  readonly thresholds: ResolvedThresholds;
  readonly checkTitles: readonly {
    readonly id: string;
    readonly title: string;
  }[];
}) {
  const [title, setTitle] = useState(objective.title);
  const titles = useMemo(
    () => new Map(checkTitles.map((entry) => [entry.id, entry.title])),
    [checkTitles],
  );

  const { verdicts, views } = useMemo(() => {
    const strictness = thresholds["quality.coachStrictness"];
    const set: KeyResultInput[] = keyResults.map((row) => ({
      text: row.title,
      baseline: row.baseline,
      target: row.target,
      dueOn: row.dueOn,
      ownerId: row.ownerId,
      indicatorType: row.indicatorType,
      direction: row.direction,
      confidence: row.confidence,
    }));

    const objectiveVerdicts = applyStrictness(
      evaluateObjective({ ...objective, title }, thresholds),
      strictness,
    );
    const keyResultVerdicts = applyStrictness(
      evaluateKeyResults({ keyResults: set }, thresholds),
      strictness,
    );

    return {
      verdicts: [...objectiveVerdicts, ...keyResultVerdicts],
      views: [
        ...objectiveVerdicts.map((verdict) => viewOf(verdict, titles, [])),
        ...keyResultVerdicts.map((verdict) =>
          viewOf(
            verdict,
            titles,
            verdict.keyResults.map(
              (index) => keyResults[index]?.title ?? `key result ${index + 1}`,
            ),
          ),
        ),
      ],
    };
  }, [objective, keyResults, thresholds, title, titles]);

  const counts = verdicts.reduce(
    (carry, verdict) => ({
      ...carry,
      [verdict.status]: carry[verdict.status] + 1,
    }),
    { pass: 0, warn: 0, fail: 0, todo: 0 } as Record<QualityStatus, number>,
  );

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-ink-2">
          Objective, checked as you type
        </span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
        <span className="text-xs text-ink-4">
          Nothing is saved by typing here. Warnings never block writing, which
          is §4's own rule.
        </span>
      </label>

      <StrengthMeter
        score={strengthScore(verdicts)}
        counts={counts}
        bands={thresholds["quality.strengthScoreBands"]}
      />

      <div className="flex flex-wrap gap-1.5">
        {views
          .filter((view) => view.status !== "pass")
          .map((view) => (
            <RuleVerdict key={view.id} verdict={view} />
          ))}
      </div>

      {views.every((view) => view.status === "pass") ? (
        <p className="text-xs text-ok-text">
          Every check passes. Read it aloud once more, then publish.
        </p>
      ) : null}
    </div>
  );
}
