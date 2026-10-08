import {
  applyEnforcement,
  evaluateKeyResults,
  evaluateObjective,
  isEasing,
  type ResolvedPractice,
  type ResolvedThresholds,
} from "@openokr/method";
import { useMemo, useState } from "react";
import type { KeyResultFields, OkrGoal } from "../../lib/okr-tree/cache.ts";
import type { OkrHandle } from "../../lib/okr-tree/use-okr-tree.ts";

/**
 * All a cell sends through. Only `mutate`, which the query library keeps the
 * same from render to render, so a surface can hand it down without every
 * cell drawing again when anything else about the change state moves.
 */
export type OkrWrite = Pick<OkrHandle, "mutate">;

import type { ShownVerdict } from "./okr-cells.tsx";

/**
 * What an objective's and a key result's cells do, wherever they are drawn
 * (P9-T08a): the list's rows and the drawer's fields are two layouts of one
 * set of edits, so the coaching, the eased target's reason and the write each
 * cell sends are written once here rather than twice beside each layout.
 */

/** What the coaching chips judge by: this workspace's numbers and practice. */
export interface Coach {
  readonly thresholds: ResolvedThresholds;
  readonly practice: ResolvedPractice;
}

/** Whether the strict mode the server judges by is on, for the coaching. */
function strictFor(coach: Coach): boolean {
  return (
    coach.practice.strictMode === "on" ||
    coach.thresholds["quality.coachStrictness"] === "strict"
  );
}

/** The checks that judge an objective's wording, against a draft title. */
function objectiveVerdicts(
  title: string,
  goal: OkrGoal,
  coach: Coach,
): ShownVerdict[] {
  return applyEnforcement(
    evaluateObjective(
      {
        title,
        hasCycle: goal.cycleId !== null,
        hasTimeframe: false,
        championId: goal.champion.id,
        reviewerId: goal.reviewer?.id ?? null,
        reviewerRequired: coach.practice.reviewer === "required",
        objectivesInUnit: 1,
        level: goal.level,
      },
      coach.thresholds,
    ),
    coach.practice,
    { strict: strictFor(coach) },
  ).filter(
    (verdict) =>
      (verdict.id === "OBJ-1" || verdict.id === "OBJ-2") &&
      verdict.status !== "pass",
  );
}

/** The checks that judge one key result's wording, against a draft title. */
function keyResultVerdicts(
  text: string,
  keyResult: OkrGoal["keyResults"][number],
  coach: Coach,
): ShownVerdict[] {
  return applyEnforcement(
    evaluateKeyResults(
      {
        keyResults: [
          {
            text,
            baseline: keyResult.baselineValue,
            target: keyResult.targetValue,
            dueOn: keyResult.dueOn,
            ownerId: keyResult.owner?.id ?? null,
            indicatorType: keyResult.indicatorType,
            direction: keyResult.direction,
            confidence: keyResult.confidence,
            // KR-2, KR-3 and KR-7 judge by kind, as the server does.
            keyResultKind: keyResult.kind,
          },
        ],
      },
      coach.thresholds,
    ),
    coach.practice,
    { strict: strictFor(coach) },
  ).filter(
    (verdict) =>
      (verdict.id === "KR-2" || verdict.id === "KR-5") &&
      verdict.status !== "pass" &&
      verdict.keyResults.includes(0),
  );
}

/** The stored verdicts, at rest: the checks this row failed when last saved. */
function storedVerdicts(flags: readonly string[]): ShownVerdict[] {
  return flags.map((id) => ({ id, status: "fail", prompt: id }));
}

/** An objective's title, coached as it is typed and stored verdicts at rest. */
export function useObjectiveCells(goal: OkrGoal, okr: OkrWrite, coach: Coach) {
  const [draft, setDraft] = useState<string | null>(null);
  const verdicts = useMemo(
    () =>
      draft === null
        ? storedVerdicts(
            goal.quality.flags.filter((id) => id.startsWith("OBJ-")),
          )
        : objectiveVerdicts(draft, goal, coach),
    [draft, goal, coach],
  );
  return {
    verdicts,
    onDraft: setDraft,
    saveTitle: (title: string) =>
      okr.mutate({
        kind: "patchGoal",
        id: goal.id,
        set: { title },
        read: { title: goal.title },
      }),
    /** Committed or aspirational, with why (METHOD.md §2.8, P9-T11b-a). */
    saveKind: (okrKind: OkrGoal["kind"], reason: string | undefined) =>
      okr.mutate({
        kind: "setKind",
        id: goal.id,
        okrKind,
        ...(reason ? { reason } : {}),
      }),
    saveChampion: (championId: string | null) => {
      if (championId) {
        okr.mutate({
          kind: "patchGoal",
          id: goal.id,
          set: { championId },
          read: { championId: goal.champion.id },
        });
      }
    },
  };
}

type PatchableKeyResult = Omit<KeyResultFields, "currentValue" | "targetValue">;

/**
 * A key result's cells. The target is the one with a second step: easing it
 * where the workspace asks for a reason holds the new value until the reason
 * is given, and thinking again puts the cell back (`targetCell` remounts it).
 */
export function useKeyResultCells(
  keyResult: OkrGoal["keyResults"][number],
  okr: OkrWrite,
  coach: Coach,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const [easing, setEasing] = useState<number | null>(null);
  const [targetCell, setTargetCell] = useState(0);
  const verdicts = useMemo(
    () =>
      draft === null
        ? storedVerdicts(keyResult.qualityFlags)
        : keyResultVerdicts(draft, keyResult, coach),
    [draft, keyResult, coach],
  );
  const reasonRequired = coach.practice["reasons.easingTarget"] === "required";

  const patch = (
    set: PatchableKeyResult,
    read: Record<string, string | number | boolean | null>,
  ) => okr.mutate({ kind: "patchKeyResult", id: keyResult.id, set, read });

  return {
    verdicts,
    onDraft: setDraft,
    patch,
    /** Metric, maintain, milestone or baseline (METHOD.md §2.10). */
    saveKind: (kind: NonNullable<PatchableKeyResult["kind"]>) =>
      patch({ kind }, { kind: keyResult.kind }),
    /** A milestone ticked done, or unticked. */
    saveDone: (done: boolean) =>
      patch({ done }, { done: keyResult.doneAt !== null }),
    /** A value is history, recorded the way a check-in records it. */
    saveValue: (value: number) =>
      okr.mutate({ kind: "recordValue", id: keyResult.id, value }),
    easing,
    targetCell,
    saveTarget: (targetValue: number) => {
      if (
        reasonRequired &&
        // A first target eases nothing, so it never asks (P9-T13-b-a).
        keyResult.targetValue !== null &&
        isEasing({
          from: keyResult.targetValue,
          to: targetValue,
          baseline: keyResult.baselineValue,
          direction: keyResult.direction,
          keyResultKind: keyResult.kind,
        })
      ) {
        setEasing(targetValue);
        return;
      }
      okr.mutate({ kind: "changeTarget", id: keyResult.id, targetValue });
    },
    saveReason: (reason: string) => {
      if (easing === null) {
        return;
      }
      okr.mutate({
        kind: "changeTarget",
        id: keyResult.id,
        targetValue: easing,
        reason,
      });
      setEasing(null);
    },
    cancelReason: () => {
      setEasing(null);
      setTargetCell((count) => count + 1);
    },
  };
}
