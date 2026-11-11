/**
 * Where somebody who reads "AI off" can go to change it (plan 0.8.1 CP8,
 * UIUX-PLAN S-39 "AI off with a link for admins").
 *
 * The panel said why the copilot could not answer and left it there, so a
 * person who could fix it was not told where, and one who could not was not
 * told that a key of their own would. Each link is offered only to somebody
 * whose level reaches its page, because a link that opens not-found is worse
 * than no link.
 *
 * Pure, so the rule is tested without a database: the server action reads the
 * facts and this decides.
 */
import type { AIOffReason } from "@openokr/core";

/** A page that can turn the copilot back on, in the order they are shown. */
export type CopilotFix = "aiSettings" | "plan" | "personalKeys";

export interface CopilotFixFacts {
  /** True when a question asked now would get prose back. */
  readonly available: boolean;
  /** The step that left the workspace with no drafter. Null when there is one. */
  readonly offReason: AIOffReason | null;
  /** The reader may open `/admin/ai` (`manage_ai`, which is `full` today). */
  readonly reachesAiSettings: boolean;
  /** The reader may open `/admin/plan`, which exists only where plans do. */
  readonly reachesPlan: boolean;
  /** The workspace takes a member's own key for at least one provider. */
  readonly personalKeysOffered: boolean;
}

/** The pages worth linking, for this reader, for this reason. */
export function copilotFixes(facts: CopilotFixFacts): readonly CopilotFix[] {
  if (facts.available) {
    return [];
  }
  const fixes: CopilotFix[] = [];
  const planReason =
    facts.offReason === "plan_without_credits" ||
    facts.offReason === "credits_used";
  // Credits spent for the month are bought on the Plan page; the AI page
  // cannot help. Every other reason, a cap included, is set on the AI page.
  if (facts.reachesAiSettings && facts.offReason !== "credits_used") {
    fixes.push("aiSettings");
  }
  if (facts.reachesPlan && planReason) {
    fixes.push("plan");
  }
  // Only with nothing configured: a key of the member's own answers for them
  // then, and changes nothing about a plan, a price or an egress rule.
  if (facts.personalKeysOffered && facts.offReason === "no_provider") {
    fixes.push("personalKeys");
  }
  return fixes;
}
