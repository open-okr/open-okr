/**
 * Why the copilot did not answer, worded from the catalogue (plan 0.9.0 CP10,
 * review 0.8.1 F15).
 *
 * The server sends a code and a few values beside its English sentence. A
 * reader in another language gets the catalogue's words for the code, and the
 * sentence stays the fallback for a reason with no code (a budget message, or
 * an answer recorded before codes existed).
 *
 * **Every key is written out in full.** The catalogue test refuses a key that
 * no source file names, so a key built from a code at run time would read as
 * unused.
 */
import type { MessageValues } from "@openokr/ui";

/** The code and values a reason carries, as the server sends them. */
export interface ReasonView {
  readonly code?: string | null;
  readonly params?: Readonly<Record<string, string>> | null;
}

type Translate = (key: string, values?: MessageValues) => string;

/** Where the reason is shown. The panel's footer says more than an answer does. */
export type ReasonPlace = "panel" | "answer";

const AI_OFF_KEYS: Readonly<
  Record<string, Readonly<Record<ReasonPlace, string>>>
> = {
  no_provider: {
    panel: "copilot.reason.aiOff.noProvider.panel",
    answer: "copilot.reason.aiOff.noProvider.answer",
  },
  plan_without_credits: {
    panel: "copilot.reason.aiOff.planWithoutCredits.panel",
    answer: "copilot.reason.aiOff.planWithoutCredits.answer",
  },
  credits_used: {
    panel: "copilot.reason.aiOff.creditsUsed.panel",
    answer: "copilot.reason.aiOff.creditsUsed.answer",
  },
  egress_blocked: {
    panel: "copilot.reason.aiOff.egressBlocked.panel",
    answer: "copilot.reason.aiOff.egressBlocked.answer",
  },
  model_unpriced: {
    panel: "copilot.reason.aiOff.modelUnpriced.panel",
    answer: "copilot.reason.aiOff.modelUnpriced.answer",
  },
};

/** The codes with no values. The two cost-cap codes carry values and are below. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  unavailable: "copilot.reason.unavailable",
  provider_error: "copilot.reason.providerError",
  nothing_to_add: "copilot.reason.nothingToAdd",
  stopped_partway: "copilot.reason.stoppedPartway",
  could_not_answer: "copilot.reason.couldNotAnswer",
};

/**
 * The reason in the reader's language, or the server's sentence when the code
 * is absent or one this build does not know. Null when there is neither.
 */
export function reasonMessage(
  t: Translate,
  sentence: string | null | undefined,
  reason: ReasonView,
  where: ReasonPlace,
): string | null {
  const params = reason.params ?? {};
  if (reason.code === "ai_off") {
    const keys = AI_OFF_KEYS[params.offReason ?? ""];
    if (keys) {
      return t(keys[where]);
    }
  } else if (reason.code === "cost_cap_before") {
    return t("copilot.reason.costCapBefore", { cap: params.cap ?? "" });
  } else if (reason.code === "cost_cap_after") {
    return t("copilot.reason.costCapAfter", {
      spent: params.spent ?? "",
      cap: params.cap ?? "",
    });
  } else if (reason.code && CODE_KEYS[reason.code]) {
    return t(CODE_KEYS[reason.code] as string);
  }
  return sentence ?? null;
}
