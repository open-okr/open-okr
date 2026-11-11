/**
 * One log line for every copilot proposal that was dropped (plan 0.8.1 A3).
 *
 * **Why it exists.** A model reply the product could not use left no trace at
 * all. Every proposal through OpenRouter came back empty for weeks (M2) and it
 * took a live test to find, because each one ended in a quiet `null` that
 * looked exactly like a question being answered.
 *
 * **What it carries, and what it never does.** The reason, the registry action
 * the model named, the feature, the provider and the model. Never the request,
 * the fields or the reply: those are a member's words, and an operator reading
 * the log has no right to them. An `action` that is not shaped like a registry
 * name is replaced, because a model can write anything into a string.
 *
 * `declined` writes nothing. It is the model saying the sentence was a
 * question, which is most sentences, and a line for each would bury the ones
 * that matter.
 */
import type { DrafterIdentity, ProposalDrop } from "../agents/drafter.ts";

/** The feature name a proposal's usage row carries, so the two can be joined. */
const FEATURE = "proposeAction";

/** A registry action's shape: a domain, a dot and a verb. Nothing else is logged. */
const ACTION_NAME = /^[a-z][A-Za-z]{0,40}\.[a-z][A-Za-z]{0,60}$/;

/** A class name, which is all of an error that is safe to log. */
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;

const writeToStderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/** The line for one drop, or null when the drop is not worth one. */
export function proposalDropLine(
  drop: ProposalDrop,
  identity: DrafterIdentity | undefined,
  now: Date = new Date(),
): Record<string, unknown> | null {
  if (drop.reason === "declined") {
    return null;
  }
  return {
    kind: "copilot.proposal_dropped",
    time: now.toISOString(),
    reason: drop.reason,
    action:
      drop.action === null
        ? null
        : ACTION_NAME.test(drop.action)
          ? drop.action
          : "unrecognised",
    feature: FEATURE,
    provider: identity?.provider ?? "unknown",
    model: identity?.model ?? "unknown",
    ...(drop.reason === "provider_error" && drop.errorName
      ? {
          error: ERROR_NAME.test(drop.errorName) ? drop.errorName : "Error",
        }
      : {}),
  };
}

/** Writes the line, if there is one. A log that cannot be written fails nobody. */
export function logProposalDrop(
  drop: ProposalDrop,
  identity: DrafterIdentity | undefined,
  write: (line: string) => void = writeToStderr,
): void {
  const line = proposalDropLine(drop, identity);
  if (line === null) {
    return;
  }
  try {
    write(JSON.stringify(line));
  } catch {
    // Nothing to do: the proposal is already dropped, and saying so is a hint.
  }
}

/** The class name of whatever was thrown, for a `provider_error`. */
export function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}
