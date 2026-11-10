/**
 * Why AI is off for a workspace, in words a reader can act on (plan 0.8.0 O1).
 *
 * The copilot said "No AI provider is configured" whenever no drafter could be
 * built, which was wrong on a managed cloud: the provider's key was set and
 * working, and the real cause was a workspace whose plan carries no AI credits.
 * Nobody in the workspace could tell what to ask for.
 *
 * **The host decides the reason, not this module.** The chain that builds a
 * provider (route, credential, plan, price, egress) lives in the web app, and
 * repeating it here would be a second copy to drift. The host walks it once,
 * names the step that stopped it, and passes the name on the action context
 * beside the drafter it could not build. This module only turns a name into a
 * sentence, so every surface says the same thing.
 *
 * A leaf module on purpose: `tenancy/credits.ts` imports the paused sentence
 * from here, so the two cannot disagree.
 */

/** The step that left a workspace with no drafter, in the order they are checked. */
export const AI_OFF_REASONS = [
  /** Nothing is configured to answer: no workspace key and no provider's key. */
  "no_provider",
  /** The provider's key is set, but this workspace's plan includes no AI credits. */
  "plan_without_credits",
  /** This month's credits are spent and no pack is left. */
  "credits_used",
  /** The workspace's AI egress controls let nothing reach the provider. */
  "egress_blocked",
  /** The model the workspace routes to has no price, so it is not used. */
  "model_unpriced",
] as const;

export type AIOffReason = (typeof AI_OFF_REASONS)[number];

/** The sentence `creditsPausedReason` returns, kept here so both read the same. */
export const CREDITS_PAUSED_SENTENCE =
  "This workspace has used its AI credits for this month. AI is paused until the 1st, or until somebody buys more. Everything else keeps working.";

/**
 * What the reason costs the reader, as one sentence.
 *
 * `panel` is the copilot's own footer, which says what the copilot can still
 * do. `answer` stands in for an answer, above the passages that matched.
 */
export function aiOffSentence(
  reason: AIOffReason,
  where: "panel" | "answer",
): string {
  const consequence =
    where === "panel"
      ? "so the copilot can find sources but cannot write an answer."
      : "so these are the passages that match your question.";
  switch (reason) {
    case "no_provider":
      return `No AI provider is configured, ${consequence}`;
    case "plan_without_credits":
      return where === "panel"
        ? `This workspace's plan includes no AI credits, ${consequence} An administrator can choose a plan with AI credits on the Plan page, or add the workspace's own AI key on the AI page.`
        : `This workspace's plan includes no AI credits, ${consequence}`;
    case "credits_used":
      return CREDITS_PAUSED_SENTENCE;
    case "egress_blocked":
      return where === "panel"
        ? `This workspace's AI privacy settings let nothing reach the AI provider, ${consequence} An administrator can change that on the AI page.`
        : `This workspace's AI privacy settings let nothing reach the AI provider, ${consequence}`;
    case "model_unpriced":
      return where === "panel"
        ? `The AI model this workspace uses has no price set, so it is not used, and the copilot can find sources but cannot write an answer. An administrator can set its price or choose another model on the AI page.`
        : `The AI model this workspace uses has no price set, so it is not used, and these are the passages that match your question.`;
  }
}
