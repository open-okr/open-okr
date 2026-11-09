import type { StageGapReason } from "@openokr/core";
import { MANAGEMENT_RETRO_QUESTIONS } from "@openokr/method";

/**
 * What a quarterly review stage is missing, in the reader's language (plan
 * 0.7.0, S1).
 *
 * `sessions.stageCompletion` returns the gap as a reason and a count, beside
 * an English sentence for callers with no catalogue. The screen says it from
 * its own catalogue instead. Typed on the reason, so a reason added to the
 * read without words here fails the typecheck rather than reaching a room as a
 * blank.
 *
 * A sentence whose wording changes with the count picks its key here, which is
 * the catalogue's rule: no plural selection inside a message. A reason that is
 * not a count has one sentence and takes no value, because the catalogue
 * refuses a value its message has no hole for.
 */
const GAP_MESSAGES: Readonly<
  Record<
    StageGapReason,
    { readonly one: string; readonly many: string } | { readonly plain: string }
  >
> = {
  pulses: {
    one: "session.detail.stageGap.pulsesOne",
    many: "session.detail.stageGap.pulsesMany",
  },
  noKeyResults: { plain: "session.detail.stageGap.noKeyResults" },
  scores: {
    one: "session.detail.stageGap.scoresOne",
    many: "session.detail.stageGap.scoresMany",
  },
  noObjectives: { plain: "session.detail.stageGap.noObjectives" },
  narratives: {
    one: "session.detail.stageGap.narrativesOne",
    many: "session.detail.stageGap.narrativesMany",
  },
  recognition: { plain: "session.detail.stageGap.recognition" },
  answers: {
    one: "session.detail.stageGap.answersOne",
    many: "session.detail.stageGap.answersMany",
  },
  notScored: { plain: "session.detail.stageGap.notScored" },
  causes: {
    one: "session.detail.stageGap.causesOne",
    many: "session.detail.stageGap.causesMany",
  },
  survey: {
    one: "session.detail.stageGap.surveyOne",
    many: "session.detail.stageGap.surveyMany",
  },
  decisions: {
    one: "session.detail.stageGap.decisionsOne",
    many: "session.detail.stageGap.decisionsMany",
  },
  learning: { plain: "session.detail.stageGap.learning" },
  owners: {
    one: "session.detail.stageGap.ownersOne",
    many: "session.detail.stageGap.ownersMany",
  },
};

export function stageGapText(
  gap: { readonly reason: StageGapReason; readonly count: number },
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const keys = GAP_MESSAGES[gap.reason];
  if ("plain" in keys) {
    return t(keys.plain);
  }
  const key = gap.count === 1 ? keys.one : keys.many;
  return gap.reason === "answers"
    ? // Stage six's four questions are canon, so the number comes from the
      // method package rather than from the sentence.
      t(key, { count: gap.count, asked: MANAGEMENT_RETRO_QUESTIONS.length })
    : t(key, { count: gap.count });
}
