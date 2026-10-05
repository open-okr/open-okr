/**
 * METHOD.md §2.9's live or draft, under "Live" (P9-T13-b-a).
 *
 * An objective or a key result added mid-cycle is live as soon as it passes
 * the checks set to block (§4). Until then it is a draft its space can see,
 * and the list says what is missing. This is the one place that decides
 * which, so the list, the drawer, the diagram and the API cannot disagree.
 *
 * **Only the item's own checks count.** A check that judges the set, OBJ-5's
 * count of objectives in a unit, KR-4's mix, KR-6's average and the alignment
 * checks, belongs to the publish gates, which a mid-cycle addition never faces
 * (§4.5). KR-1 is the exception: an objective's key results are part of the
 * objective, and one with none is not finished.
 *
 * **What is missing is named as a field where it can be.** KR-3 fails on "a
 * target, a date or an owner", and a writer needs to know which, so the
 * reading looks at the fields rather than repeating the check's sentence. Any
 * other check set to block is named by its id, for the screen to title.
 *
 * Pure, like every other reading in this package: the server reads it into
 * the tree and nothing else computes it.
 */
import { applyEnforcement } from "./enforcement.ts";
import type { ResolvedPractice } from "./practice.ts";
import {
  evaluateKeyResults,
  evaluateObjective,
  type KeyResultInput,
  type ObjectiveInput,
} from "./quality.ts";
import type { ResolvedThresholds } from "./thresholds.ts";

/** The fields a draft can be missing, in the order a writer meets them. */
export const ADDITION_FIELDS = [
  "keyResult",
  "baseline",
  "target",
  "dueDate",
  "owner",
  "reviewer",
] as const;
export type AdditionField = (typeof ADDITION_FIELDS)[number];

/** What an addition still lacks. Both lists empty is live. */
export interface AdditionDraft {
  /** The fields the failing checks ask for. */
  readonly missing: readonly AdditionField[];
  /** Any other check set to block that it fails, by id. */
  readonly failing: readonly string[];
}

export interface AdditionOptions {
  /** Strict mode for this workspace or this space, as the server judges. */
  readonly strict?: boolean;
}

/** The checks that judge a set rather than the item, left to the gates. */
const SET_CHECKS: ReadonlySet<string> = new Set(["OBJ-5"]);

const ordered = (fields: ReadonlySet<AdditionField>): AdditionField[] =>
  ADDITION_FIELDS.filter((field) => fields.has(field));

const draftOrNull = (
  missing: ReadonlySet<AdditionField>,
  failing: readonly string[],
): AdditionDraft | null =>
  missing.size === 0 && failing.length === 0
    ? null
    : { missing: ordered(missing), failing };

/**
 * A key result added mid-cycle: null when it is live, or what it lacks.
 *
 * Judged alone, so a set-level check cannot make one key result a draft for
 * what its siblings did.
 */
export function keyResultDraft(
  entry: KeyResultInput,
  thresholds: ResolvedThresholds,
  practice: ResolvedPractice,
  options: AdditionOptions = {},
): AdditionDraft | null {
  const failed = applyEnforcement(
    evaluateKeyResults({ keyResults: [entry] }, thresholds),
    practice,
    options,
  ).filter(
    (verdict) => verdict.status === "fail" && verdict.keyResults.includes(0),
  );

  const missing = new Set<AdditionField>();
  const failing: string[] = [];
  const kind = entry.keyResultKind ?? "metric";
  for (const verdict of failed) {
    if (verdict.id !== "KR-3") {
      failing.push(verdict.id);
      continue;
    }
    if ((kind === "metric" || kind === "maintain") && entry.target === null) {
      missing.add("target");
    }
    if (entry.dueOn === null) {
      missing.add("dueDate");
    }
    if (entry.ownerId === null) {
      missing.add("owner");
    }
    // KR-3 warns on a missing baseline, which only a workspace that raised
    // KR-3 to block, or runs strict, turns into a reason to wait.
    if (kind === "metric" && entry.baseline === null) {
      missing.add("baseline");
    }
  }
  return draftOrNull(missing, failing);
}

/**
 * An objective added mid-cycle: null when it is live, or what it lacks.
 *
 * Its key results are passed for KR-1 only. Each one's own draft is its own,
 * so an objective whose champion is named is live while a key result under it
 * still waits for a target.
 */
export function objectiveDraft(
  objective: Omit<ObjectiveInput, "objectivesInUnit">,
  keyResults: readonly KeyResultInput[],
  thresholds: ResolvedThresholds,
  practice: ResolvedPractice,
  options: AdditionOptions = {},
): AdditionDraft | null {
  const failed = [
    ...applyEnforcement(
      // OBJ-5 is left to the gates, so the count it reads does not matter.
      evaluateObjective({ ...objective, objectivesInUnit: 1 }, thresholds),
      practice,
      options,
    ),
    ...applyEnforcement(
      evaluateKeyResults({ keyResults }, thresholds),
      practice,
      options,
    ).filter((verdict) => verdict.id === "KR-1"),
  ].filter(
    (verdict) => verdict.status === "fail" && !SET_CHECKS.has(verdict.id),
  );

  const missing = new Set<AdditionField>();
  const failing: string[] = [];
  for (const verdict of failed) {
    if (verdict.id === "KR-1" && keyResults.length === 0) {
      missing.add("keyResult");
    } else if (verdict.id === "OBJ-4") {
      if (objective.championId === null) {
        missing.add("owner");
      }
      if (objective.reviewerRequired && objective.reviewerId === null) {
        missing.add("reviewer");
      }
    } else {
      failing.push(verdict.id);
    }
  }
  return draftOrNull(missing, failing);
}
