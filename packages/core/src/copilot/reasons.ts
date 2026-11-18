/**
 * Why the copilot did not answer, as a code and not as a sentence (plan 0.9.0
 * CP10, review 0.8.1 F15).
 *
 * The server used to build the English sentence and the panel showed it as it
 * was, so a Malay reader got every reason in English. UIUX-PLAN §8 asks for
 * message catalogues and no concatenated strings. A reason is now a code and a
 * few values, and the panel words it from its own catalogue.
 *
 * **The sentence is still here.** REST, MCP and the chat channels read the same
 * thread and have no catalogue, so `reasonSentence` keeps today's English for
 * them. A sentence that arrives with no code (a budget message from the
 * availability check, or a row written before this change) is shown as it is.
 *
 * Pure: no database, no framework. The codes are stored as JSON in
 * `ai_messages.run_halted_reason`, which is a text column, so no migration.
 */
import {
  AI_OFF_REASONS,
  type AIOffReason,
  aiOffSentence,
} from "../ai/off-reason.ts";

/**
 * One code per thing the copilot says about why there is no answer.
 *
 * `ai_off` is one code with the step that stopped it in `params.offReason`,
 * because the five steps are one idea and the panel picks its wording by where
 * it shows the reason.
 */
export const COPILOT_REASON_CODES = [
  /** No drafter could be built. `params.offReason` names the step. */
  "ai_off",
  /** The copilot is off for this member right now, with no more detail. */
  "unavailable",
  /** The provider threw, so only the passages are shown. */
  "provider_error",
  /** The provider answered with no text. */
  "nothing_to_add",
  /** The provider stopped mid-answer. What arrived is kept. */
  "stopped_partway",
  /** The run's cost cap is zero, so it halted before starting. `params.cap`. */
  "cost_cap_before",
  /** The answer cost more than the cap. `params.spent`, `params.cap`. */
  "cost_cap_after",
  /** The inline route failed. The question was saved. */
  "could_not_answer",
] as const;

export type CopilotReasonCode = (typeof COPILOT_REASON_CODES)[number];

export interface CopilotReason {
  readonly code: CopilotReasonCode;
  readonly params?: Readonly<Record<string, string>>;
}

/** Where a reason is shown, which decides how long its wording is. */
export type ReasonPlace = "panel" | "answer";

/** The reason a workspace's AI is off, as a code. */
export const aiOffReason = (offReason: AIOffReason): CopilotReason => ({
  code: "ai_off",
  params: { offReason },
});

/** A reason with its words, or just the words when there is no code for them. */
export type ReasonLike = CopilotReason | string;

const isCode = (value: unknown): value is CopilotReasonCode =>
  typeof value === "string" &&
  (COPILOT_REASON_CODES as readonly string[]).includes(value);

const isOffReason = (value: unknown): value is AIOffReason =>
  typeof value === "string" &&
  (AI_OFF_REASONS as readonly string[]).includes(value);

/** What is stored in `run_halted_reason` for a coded reason. */
export function encodeReason(reason: CopilotReason): string {
  return JSON.stringify(
    reason.params === undefined
      ? { code: reason.code }
      : { code: reason.code, params: reason.params },
  );
}

/**
 * The reason a stored value holds, or null.
 *
 * Null for an old English sentence, for junk and for a code this build does not
 * know, so the caller falls back to the stored text.
 */
export function decodeReason(stored: string | null): CopilotReason | null {
  if (stored === null || !stored.startsWith("{")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const { code, params } = parsed as { code?: unknown; params?: unknown };
  if (!isCode(code)) {
    return null;
  }
  if (params === undefined) {
    return { code };
  }
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return null;
  }
  const entries = Object.entries(params as Record<string, unknown>);
  if (!entries.every(([, value]) => typeof value === "string")) {
    return null;
  }
  return {
    code,
    params: Object.fromEntries(entries) as Record<string, string>,
  };
}

/**
 * The English sentence for a reason: the wording clients without a catalogue
 * read. Kept word for word from before the codes, so nothing they read changes.
 */
export function reasonSentence(
  reason: CopilotReason,
  where: ReasonPlace = "answer",
): string {
  const params = reason.params ?? {};
  switch (reason.code) {
    case "ai_off":
      return aiOffSentence(
        isOffReason(params.offReason) ? params.offReason : "no_provider",
        where,
      );
    case "unavailable":
      return "The copilot is not available in this workspace right now.";
    case "provider_error":
      return "The provider did not answer. These are the passages that match your question.";
    case "nothing_to_add":
      return "The copilot had nothing to add. These are the passages that match your question.";
    case "stopped_partway":
      return "The provider stopped partway through this answer. What arrived is kept.";
    case "cost_cap_before":
      return (
        `Halted before starting: the cost cap for this workspace is ${params.cap ?? ""}, ` +
        "so a run may not spend. An administrator sets it in AI governance."
      );
    case "cost_cap_after":
      return (
        `This answer cost ${params.spent ?? ""} and the cap for this workspace is ` +
        `${params.cap ?? ""}. The next run will halt before starting until an ` +
        "administrator raises it."
      );
    case "could_not_answer":
      return "The copilot could not answer. Your question was saved.";
  }
}

/** The words for either kind of reason. */
export const reasonText = (
  reason: ReasonLike,
  where: ReasonPlace = "answer",
): string =>
  typeof reason === "string" ? reason : reasonSentence(reason, where);

/** What goes in `run_halted_reason`: the code as JSON, or the text as it is. */
export const reasonStored = (reason: ReasonLike): string =>
  typeof reason === "string" ? reason : encodeReason(reason);

/** The `code` and `params` fields an event carries beside its text. */
export const reasonFields = (
  reason: ReasonLike,
): { code?: CopilotReasonCode; params?: Record<string, string> } =>
  typeof reason === "string"
    ? {}
    : {
        code: reason.code,
        ...(reason.params === undefined
          ? {}
          : { params: { ...reason.params } }),
      };

/** The `haltedCode` and `haltedParams` a `copilot.done` event carries. */
export const haltedFields = (
  reason: ReasonLike | null,
): {
  haltedCode: string | null;
  haltedParams: Record<string, string> | null;
} => {
  const fields = reason === null ? {} : reasonFields(reason);
  return {
    haltedCode: fields.code ?? null,
    haltedParams: fields.params ?? null,
  };
};

/**
 * The `code` and `params` of an event that came through realtime, where
 * everything is unknown until it is looked at. Nothing for a value that is not
 * the shape a reason has.
 */
export function eventReasonFields(data: {
  readonly haltedCode?: unknown;
  readonly haltedParams?: unknown;
}): { code?: string; params?: Record<string, string> } {
  if (typeof data.haltedCode !== "string" || data.haltedCode === "") {
    return {};
  }
  const params = data.haltedParams;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return { code: data.haltedCode };
  }
  const entries = Object.entries(params as Record<string, unknown>);
  return entries.every(([, value]) => typeof value === "string")
    ? {
        code: data.haltedCode,
        params: Object.fromEntries(entries) as Record<string, string>,
      }
    : { code: data.haltedCode };
}

/** What a stored halted reason reads as: the English text, and the code when it has one. */
export function storedReasonFields(stored: string | null): {
  readonly haltedReason: string | null;
  readonly haltedCode: string | null;
  readonly haltedParams: Record<string, string> | null;
} {
  const reason = decodeReason(stored);
  if (reason === null) {
    return { haltedReason: stored, haltedCode: null, haltedParams: null };
  }
  return {
    haltedReason: reasonSentence(reason, "answer"),
    haltedCode: reason.code,
    haltedParams: reason.params === undefined ? null : { ...reason.params },
  };
}
