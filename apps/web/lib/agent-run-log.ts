import { OperationError } from "@openokr/core";
import { AGENT_RUN_LOG_CODES, type AgentRunLogCode } from "@openokr/db";
import type { MessageValues } from "@openokr/ui";
import { operationMessage } from "./refusal";

type Translate = (key: string, values?: MessageValues) => string;

/** A run log line as `agents.listRuns` returns it. */
export interface RunLogLine {
  readonly message: string;
  readonly code?: string;
  readonly values?: Readonly<Record<string, string | number>>;
}

/**
 * The sentences the run executor writes itself into a value. Each is said in
 * the reader's language from its own key; the test fails when one no longer
 * occurs in `packages/agents/src/run-executor.ts`.
 */
export const RUN_LOG_SENTENCE_KEYS: ReadonlyMap<string, string> = new Map([
  [
    "No such resource, or this agent has no access to it.",
    "agents.runLog.reason.noAccess",
  ],
  [
    "no AI provider is configured for this agent's tier, and a custom agent has no deterministic form to run without one.",
    "agents.runLog.reason.noProvider",
  ],
  [
    "this workspace's AI privacy settings keep this agent's requests from reaching its provider.",
    "agents.runLog.reason.privacy",
  ],
]);

/** A code a newer release wrote is shown by its stored sentence, not a key. */
const isKnownCode = (code: string): code is AgentRunLogCode =>
  (AGENT_RUN_LOG_CODES as readonly string[]).includes(code);

/** The values that are themselves sentences, translated where known. */
const SENTENCE_VALUES = new Set(["reason", "why", "error"]);

/**
 * A sentence value in the reader's language: the executor's own sentences by
 * their key, a domain refusal through the map every refusal screen uses, and
 * anything else as it was written.
 */
function sentence(value: string, t: Translate): string {
  const own = RUN_LOG_SENTENCE_KEYS.get(value);
  if (own !== undefined) {
    return t(own);
  }
  // The code only decides whether the access-refusal shape is replaced, which
  // is the same answer a refused save gets on any other screen.
  return operationMessage(new OperationError("forbidden", value), t);
}

/**
 * One log line for `/admin/agents` (docs/design/agent-run-log-language.md §5):
 * the code through the catalogue, or the stored English sentence for a line
 * written before codes existed or by the Coach and the Champion.
 */
export function runLogText(entry: RunLogLine, t: Translate): string {
  if (!entry.code || !isKnownCode(entry.code)) {
    return entry.message;
  }
  const values: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(entry.values ?? {})) {
    values[name] =
      SENTENCE_VALUES.has(name) && typeof value === "string"
        ? sentence(value, t)
        : value;
  }
  return t(`agents.runLog.${entry.code}`, values);
}
