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
const GAP_MESSAGES: Readonly<Record<StageGapReason, string>> = {
  pulses: "session.detail.stageGap.pulses",
  noKeyResults: "session.detail.stageGap.noKeyResults",
  scores: "session.detail.stageGap.scores",
  noObjectives: "session.detail.stageGap.noObjectives",
  narratives: "session.detail.stageGap.narratives",
  recognition: "session.detail.stageGap.recognition",
  answers: "session.detail.stageGap.answers",
  notScored: "session.detail.stageGap.notScored",
  causes: "session.detail.stageGap.causes",
  survey: "session.detail.stageGap.survey",
  decisions: "session.detail.stageGap.decisions",
  learning: "session.detail.stageGap.learning",
  owners: "session.detail.stageGap.owners",
};

export function stageGapText(
  gap: { readonly reason: StageGapReason; readonly count: number },
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  const key = GAP_MESSAGES[gap.reason];
  return gap.reason === "answers"
    ? // Stage six's four questions are canon, so the number comes from the
      // method package rather than from the sentence.
      t(key, { count: gap.count, asked: MANAGEMENT_RETRO_QUESTIONS.length })
    : t(key, { count: gap.count });
}
