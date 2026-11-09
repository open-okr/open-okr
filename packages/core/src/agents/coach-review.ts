/**
 * The Coach's review of one goal, as the reply it posts (plan 0.7.0 A8).
 *
 * AI-NATIVE-PLAN §6.5, "Conversation": mention the Coach on a goal and it
 * reviews that goal and replies in the thread. **The review is METHOD.md §4.1
 * and §4.2 and nothing else**: the verdicts `evaluateGoalInTx` already stores
 * as the goal's flags, under the practice and strictness in force for its
 * space. So it is whole with the AI provider off, and the words are the
 * method's own: each point carries the check's title, the condition it saw and
 * the prompt `packages/method` holds for it, and cites the check's key.
 *
 * **Alignment checks are left out on purpose.** They are about the goal's
 * place among other goals, and a reply that named a parent or a sibling could
 * tell everybody who reads this thread about a goal they cannot open.
 *
 * Pure: it takes verdicts and titles and returns a document.
 */
import { describeRule } from "@openokr/method";
import type { GoalVerdicts } from "../quality/service.ts";
import type { RichTextDocument } from "../rich-text/schema.ts";

/** One thing the review raises. */
export interface CoachReviewPoint {
  /** The check's key, which resolves in `packages/method`. */
  readonly ruleKey: string;
  /** "KR-3 Complete": the check's key and title, from the catalogue. */
  readonly name: string;
  readonly status: "fail" | "warn" | "todo";
  /** What was seen, in the catalogue's words. */
  readonly condition: string;
  /** What to do about it, verbatim from METHOD.md §4. */
  readonly prompt: string;
  /** The key results that tripped it, by title. Empty for a set-level check. */
  readonly keyResults: readonly string[];
}

const ORDER: Record<CoachReviewPoint["status"], number> = {
  fail: 0,
  warn: 1,
  todo: 2,
};

/** How each status reads in the reply. */
const STATUS_WORD: Record<CoachReviewPoint["status"], string> = {
  fail: "Blocks",
  warn: "Warning",
  todo: "To do",
};

/**
 * The points the review raises, worst first, in catalogue order within each.
 *
 * A pass raises nothing, and neither does `info`: a check the workspace turned
 * to information asks nothing of anybody (METHOD.md §4, §12), so it is not
 * raised here either. With no key results at all, KR-1 says so and the other
 * key result checks, which have nothing to judge, stay quiet rather than
 * repeating it six times.
 *
 * **A key that does not resolve is refused, not invented.** Every check id
 * comes from the catalogue, so this can only fail if the two drift, and a reply
 * citing a rule nobody can open is the thing CLAUDE.md forbids.
 */
export function coachReviewPoints(
  verdicts: Pick<GoalVerdicts, "objective" | "keyResults" | "keyResultIds">,
  keyResultTitles: ReadonlyMap<string, string>,
): readonly CoachReviewPoint[] {
  const hasKeyResults = verdicts.keyResultIds.length > 0;
  const raised = [
    ...verdicts.objective.map((verdict) => ({ verdict, offenders: [] })),
    ...verdicts.keyResults.map((verdict) => ({
      verdict,
      offenders: verdict.keyResults,
    })),
  ].filter(
    ({ verdict }) =>
      verdict.status === "fail" ||
      verdict.status === "warn" ||
      (verdict.status === "todo" &&
        (hasKeyResults || !verdict.id.startsWith("KR-"))),
  );

  const points = raised.map(({ verdict, offenders }): CoachReviewPoint => {
    const rule = describeRule(verdict.id);
    if (!rule) {
      throw new Error(
        `The Coach's review cites ${verdict.id}, which the method package does not define.`,
      );
    }
    return {
      ruleKey: rule.key,
      name: rule.name,
      status: verdict.status as CoachReviewPoint["status"],
      condition: verdict.condition,
      prompt: verdict.prompt,
      keyResults: offenders
        .map((index) => verdicts.keyResultIds[index])
        .map((id) => (id ? keyResultTitles.get(id) : undefined))
        .filter((title): title is string => title !== undefined),
    };
  });
  // Stable, so catalogue order holds within a status.
  return [...points].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}

/** A sentence's last character, closed with a full stop where it has none. */
const closed = (text: string): string =>
  /[.?!]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/**
 * The reply, as editor JSON for the comment it posts.
 *
 * One opening line, then one bullet per point: the check in bold, how it
 * stands, what was seen, the method's prompt, the key results it names, and
 * `Rule: KR-3` as code, the same citation every proactive message ends with.
 */
export function coachReviewDocument(
  points: readonly CoachReviewPoint[],
): RichTextDocument {
  const opening =
    points.length === 0
      ? "Reviewed against the quality checks in METHOD.md §4.1 and §4.2. Nothing needs attention."
      : `Reviewed against the quality checks in METHOD.md §4.1 and §4.2. ${
          points.length === 1
            ? "One needs attention:"
            : `${points.length} need attention:`
        }`;

  const item = (point: CoachReviewPoint) => {
    const named =
      point.keyResults.length === 0
        ? ""
        : ` Key result${point.keyResults.length === 1 ? "" : "s"}: ${point.keyResults
            .map((title) => `"${title}"`)
            .join(", ")}.`;
    return {
      type: "listItem",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: point.name, marks: [{ type: "bold" }] },
            {
              type: "text",
              text: ` (${STATUS_WORD[point.status]}). ${closed(point.condition)} ${closed(point.prompt)}${named} Rule: `,
            },
            { type: "text", text: point.ruleKey, marks: [{ type: "code" }] },
          ],
        },
      ],
    };
  };

  // Cast because `RichTextDocument`'s node type is a recursive union the
  // literals above cannot be checked against piecewise. The test runs the
  // result through `isValidRichText`, which is the check that matters.
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: opening }] },
      ...(points.length === 0
        ? []
        : [{ type: "bulletList", content: points.map(item) }]),
    ],
  } as unknown as RichTextDocument;
}
