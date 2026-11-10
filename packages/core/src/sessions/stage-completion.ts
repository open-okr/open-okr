/**
 * Each quarterly review stage's completion condition (docs/design/sessions.md
 * §4.1, plan 0.7.0 S1).
 *
 * **Shown, never enforced.** METHOD.md §8.1 says of the stages that "the
 * facilitator lands it and moves", and makes only stage two a gate (§8.3).
 * Akmal decided on 9 November 2026 that the rail shows each condition and an
 * incomplete stage never refuses the advance; stage two's refusal stays where
 * it is, in `sessions.advanceStage`.
 *
 * **Pure, over what the stage reads already load.** `sessions.stageCompletion`
 * and each stage's own read (`sessions.scoringStatus`, `sessions.narratives`,
 * `sessions.managementRetro`, `sessions.rootCauses`, `sessions.reset`) call
 * these same functions for `complete`, so the rail and a panel's chip cannot
 * give two answers about one stage.
 */

/** What a stage is missing, as data a screen can say in its own language. */
export const STAGE_GAP_REASONS = [
  /** Stage 1: participants with no pulse and word. */
  "pulses",
  /** Stage 2: the review covers no key results at all. */
  "noKeyResults",
  /** Stage 2: key results with no score and reason. */
  "scores",
  /** Stages 3 and 9: the review covers no open objectives. */
  "noObjectives",
  /** Stage 3: objectives nobody has spoken for. */
  "narratives",
  /** Stage 4: nobody recognised. */
  "recognition",
  /** Stage 6: management questions with no answer. */
  "answers",
  /** Stage 7: nothing graded, so nothing can be read against a threshold. */
  "notScored",
  /** Stage 7: key results below their threshold with no cause. */
  "causes",
  /** Stage 8: participants who have not scored the process. */
  "survey",
  /** Stage 9: objectives with no decision. */
  "decisions",
  /** Stage 10: no learning captured. */
  "learning",
  /** Stage 11: actions whose owner is no longer an active member. */
  "owners",
] as const;
export type StageGapReason = (typeof STAGE_GAP_REASONS)[number];

export interface StageGap {
  readonly reason: StageGapReason;
  /** How many are missing. Nought where the reason is not a count. */
  readonly count: number;
}

export interface StageCondition {
  readonly complete: boolean;
  /** Null when complete. */
  readonly gap: StageGap | null;
}

const MET: StageCondition = { complete: true, gap: null };

function short(reason: StageGapReason, count = 0): StageCondition {
  return { complete: false, gap: { reason, count } };
}

/**
 * Stage 1: every participant has a pulse and one word.
 *
 * Participants are the space's active members, the same list
 * `sessions.roomPulse` counts as expected. A pulse from somebody outside it
 * does not stand in for one from inside.
 */
export function pulseCondition(
  participantIds: readonly string[],
  pulses: readonly {
    readonly memberId: string;
    readonly pulse: number | null;
    readonly word: string | null;
  }[],
): StageCondition {
  const spoken = new Set(
    pulses
      .filter((row) => row.pulse !== null && (row.word ?? "").trim() !== "")
      .map((row) => row.memberId),
  );
  const missing = participantIds.filter((id) => !spoken.has(id)).length;
  return missing === 0 ? MET : short("pulses", missing);
}

/**
 * Stage 2: every key result has a score, evidence and a reason.
 *
 * Evidence is the key result's own baseline, target and actual, read from the
 * key result rather than recorded by the room, so the stored half of the
 * condition is a grade with its line on why. A review with nothing to grade is
 * not complete: it is a review with no key results, and the room should hear
 * that rather than see a tick.
 */
export function scoringCondition(
  keyResults: readonly {
    readonly score: number | null;
    readonly reason: string | null;
  }[],
): StageCondition {
  if (keyResults.length === 0) {
    return short("noKeyResults");
  }
  const missing = keyResults.filter(
    (row) => row.score === null || (row.reason ?? "").trim() === "",
  ).length;
  return missing === 0 ? MET : short("scores", missing);
}

/** Stage 3: each objective's owner has spoken, which the mic moving on marks. */
export function narrativesCondition(
  objectives: readonly { readonly spokenAt: unknown }[],
): StageCondition {
  if (objectives.length === 0) {
    return short("noObjectives");
  }
  const missing = objectives.filter((row) => row.spokenAt === null).length;
  return missing === 0 ? MET : short("narratives", missing);
}

/** Stage 4: at least one recognition entered. */
export function recognitionCondition(entries: number): StageCondition {
  return entries > 0 ? MET : short("recognition");
}

/** Stage 6: all four management questions answered. */
export function managementCondition(
  answered: number,
  asked: number,
): StageCondition {
  const missing = Math.max(0, asked - answered);
  return missing === 0 ? MET : short("answers", missing);
}

/**
 * Stage 7: every key result below its root-cause threshold has a cause.
 *
 * Nothing graded is not nothing missed (P4-T11b): the stage cannot say every
 * miss has a cause before anything has been read against its threshold. Once
 * something is graded and nothing came in under, there is nothing to name.
 */
export function rootCauseCondition(
  graded: number,
  missed: readonly { readonly causeKey: number | null }[],
): StageCondition {
  if (graded === 0) {
    return short("notScored");
  }
  const missing = missed.filter((row) => row.causeKey === null).length;
  return missing === 0 ? MET : short("causes", missing);
}

/** Stage 8: every participant has submitted the survey. */
export function surveyCondition(notSubmitted: number): StageCondition {
  return notSubmitted === 0 ? MET : short("survey", notSubmitted);
}

/** Stage 9: every objective has a decision. */
export function resetCondition(
  objectives: readonly { readonly decision: string | null }[],
): StageCondition {
  if (objectives.length === 0) {
    return short("noObjectives");
  }
  const missing = objectives.filter((row) => row.decision === null).length;
  return missing === 0 ? MET : short("decisions", missing);
}

/** Stage 10: at least one learning captured. */
export function learningsCondition(learnings: number): StageCondition {
  return learnings > 0 ? MET : short("learning");
}

/**
 * Stage 11: every action has a name and a date.
 *
 * Both columns are required, so every stored action has a date and an owner.
 * What can still go missing is the person: `sessions.addAction` refuses a
 * suspended owner because "an action owned by a suspended member is an action
 * with nobody on it", and an owner suspended after the action was agreed is
 * the same gap arriving later. No actions at all is not a wish, so it is not
 * a gap.
 */
export function actionsCondition(
  actions: readonly { readonly ownerActive: boolean }[],
): StageCondition {
  const missing = actions.filter((row) => !row.ownerActive).length;
  return missing === 0 ? MET : short("owners", missing);
}

/**
 * The gap as one English sentence, for a caller with no catalogue: the
 * command line, REST and an agent. The screen says the same thing from its
 * own catalogue, keyed on the reason.
 */
export function stageGapSentence(gap: StageGap, asked = 4): string {
  const one = gap.count === 1;
  switch (gap.reason) {
    case "pulses":
      return one
        ? "1 participant has not given a pulse and a word."
        : `${gap.count} participants have not given a pulse and a word.`;
    case "noKeyResults":
      return "This review has no key results to score.";
    case "scores":
      return one
        ? "1 key result has no score and reason yet."
        : `${gap.count} key results have no score and reason yet.`;
    case "noObjectives":
      return "This review has no open objectives.";
    case "narratives":
      return one
        ? "1 objective has not been spoken for."
        : `${gap.count} objectives have not been spoken for.`;
    case "recognition":
      return "Nobody has been recognised yet.";
    case "answers":
      return one
        ? `1 of the ${asked} management questions has no answer yet.`
        : `${gap.count} of the ${asked} management questions have no answer yet.`;
    case "notScored":
      return "No key result has been scored yet.";
    case "causes":
      return one
        ? "1 key result below its threshold has no cause."
        : `${gap.count} key results below their threshold have no cause.`;
    case "survey":
      return one
        ? "1 participant has not scored the process yet."
        : `${gap.count} participants have not scored the process yet.`;
    case "decisions":
      return one
        ? "1 objective has no decision yet."
        : `${gap.count} objectives have no decision yet.`;
    case "learning":
      return "No learning has been captured yet.";
    case "owners":
      return one
        ? "1 action has an owner who is no longer an active member."
        : `${gap.count} actions have an owner who is no longer an active member.`;
  }
}
