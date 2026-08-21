/**
 * The drafting capability, implemented against a real provider (P4-T05c-b).
 *
 * `packages/core` declares `AgentDrafter` and never imports a driver;
 * `packages/adapters` holds every driver and knows nothing about the method.
 * This package is the one allowed to depend on both, which is why the
 * implementation lives here and the interface does not.
 *
 * **Every method answers null rather than throwing.** A provider that is off, a
 * budget that is spent, a network that is down, or output the schema refused
 * twice all end the same way: the caller carries on with the deterministic
 * answer. The rhythm is the part that has to work, and a model having a bad
 * minute must not take it down. The one thing that is never done is guessing:
 * `extractStructured` validates with one repair attempt and then fails, and a
 * failure here means no draft rather than an unvalidated one.
 */
import type { AIProvider } from "@openokr/adapters";
import type {
  AgentDrafter,
  CheckInDraftContext,
  DraftedCheckIn,
  RecoveryTitleContext,
} from "@openokr/core";
import { z } from "zod";
import { extractStructured } from "./structured-extraction.ts";

/** What the model is asked for. Narrower than the product's own types on purpose. */
const CHECK_IN_SHAPE = z.object({
  status: z.enum(["on_track", "caution", "off_track"]),
  confidence: z.number().min(0).max(1),
  /** Plain text. The document is assembled here, never by the model. */
  narrative: z.string().trim().min(1).max(2000),
});

const CHECK_IN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "confidence", "narrative"],
  properties: {
    status: { type: "string", enum: ["on_track", "caution", "off_track"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    narrative: { type: "string", maxLength: 2000 },
  },
} as const;

const TITLE_SHAPE = z.object({
  title: z.string().trim().min(1).max(180),
});

const TITLE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: { title: { type: "string", maxLength: 180 } },
} as const;

/**
 * The Champion's own voice, stated once.
 *
 * No threshold, band or check appears here. Those are `packages/method`'s, they
 * are cited by rule key, and a prompt restating one would be a second copy of
 * the canon that nothing verifies.
 */
const CHECK_IN_SYSTEM =
  "You draft a weekly check-in for the person who owns a goal, in their " +
  "voice, for them to correct before publishing. Be specific and short: " +
  "three sentences at most. Say what moved, what did not, and what happens " +
  "next. Never invent a number that was not given to you, never congratulate, " +
  "and never apologise on anybody's behalf.";

const TITLE_SYSTEM =
  "You name a recovery objective for a metric that has been unhealthy. One " +
  "line, an outcome rather than an activity, no more than twelve words, no " +
  "trailing full stop. Name the metric.";

export interface ProviderDrafterOptions {
  readonly provider: AIProvider;
  /** The model this workspace's tier map resolved to. */
  readonly model: string;
  /**
   * Dollars this run may spend, from §4.14's `agentRunCostCapUsd`.
   *
   * Checked before every call rather than after, because a call that has
   * already been made has already been paid for.
   */
  readonly costCapUsd: number;
  /** Dollars per million tokens, for turning usage into spend. */
  readonly costInPerMillion: number;
  readonly costOutPerMillion: number;
}

/** Editor JSON from one paragraph of plain text, which is all a model returns. */
const asDocument = (text: string) => ({
  type: "doc" as const,
  content: [
    {
      type: "paragraph" as const,
      content: [{ type: "text" as const, text }],
    },
  ],
});

export function createProviderDrafter(
  options: ProviderDrafterOptions,
): AgentDrafter {
  let spent = 0;

  /** Whether another call is affordable. Asked before spending, never after. */
  const affordable = () => options.costCapUsd > 0 && spent < options.costCapUsd;

  /**
   * Charged per provider call, which is what `onUsage` reports.
   *
   * Per call rather than per draft, because `extractStructured` may make a
   * second one to repair invalid output and that call is paid for too. The cap
   * therefore catches a model that needs repairing twice as often.
   */
  const charge = (usage?: {
    inputTokens?: number;
    outputTokens?: number;
  }): void => {
    const input = usage?.inputTokens ?? 0;
    const output = usage?.outputTokens ?? 0;
    spent +=
      (input * options.costInPerMillion + output * options.costOutPerMillion) /
      1_000_000;
  };

  return {
    async draftCheckIn(
      context: CheckInDraftContext,
    ): Promise<DraftedCheckIn | null> {
      if (!affordable()) {
        return null;
      }
      const measures = context.keyResults
        .map(
          (kr: { title: string; progressPct: number }) =>
            `- ${kr.title}: ${kr.progressPct}% of the way there`,
        )
        .join("\n");
      try {
        const drafted = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: CHECK_IN_SHAPE,
          jsonSchema: CHECK_IN_JSON_SCHEMA,
          maxTokens: 400,
          onUsage: charge,
          messages: [
            { role: "system", content: CHECK_IN_SYSTEM },
            {
              role: "user",
              content:
                `Goal: ${context.goalTitle}\n` +
                `Days overdue: ${context.daysOverdue}\n` +
                `Last reported status: ${context.previousStatus ?? "never reported"}\n` +
                `Key results:\n${measures || "- none recorded"}`,
            },
          ],
        });
        return {
          status: drafted.status,
          confidence: drafted.confidence,
          narrative: asDocument(drafted.narrative),
        };
      } catch {
        return null;
      }
    },

    async refineRecoveryTitle(
      context: RecoveryTitleContext,
    ): Promise<string | null> {
      if (!affordable()) {
        return null;
      }
      try {
        const { title } = await extractStructured({
          provider: options.provider,
          model: options.model,
          schema: TITLE_SHAPE,
          jsonSchema: TITLE_JSON_SCHEMA,
          maxTokens: 80,
          onUsage: charge,
          messages: [
            { role: "system", content: TITLE_SYSTEM },
            {
              role: "user",
              content:
                `Metric: ${context.kpiTitle}\n` +
                `Current achievement: ${context.achievementPct ?? "unknown"}%\n` +
                `The template would say: ${context.templateTitle}`,
            },
          ],
        });
        // **A title identical to the template is not a refinement.** Asked to
        // improve on a sentence, a model will sometimes hand the same sentence
        // back, and returning it would mark the proposal AI-generated for
        // words no model chose. Observed on the first live run against
        // OpenRouter, which returned the template verbatim.
        return title.trim() === context.templateTitle.trim() ? null : title;
      } catch {
        return null;
      }
    },

    spentUsd: () => spent,
  };
}
