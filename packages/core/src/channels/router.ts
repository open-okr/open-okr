/**
 * Running a chat command, and refusing one (AI-NATIVE-PLAN.md §6 steps seven
 * and eight, P5-T06a).
 *
 * `resolveInbound` answers who is speaking. This answers what they asked for,
 * and the two are separate because the first four questions are about the
 * sender and these two are about the request.
 *
 * **The refusal is the browser's own sentence, because it is the browser's own
 * code path.** Nothing here checks access: the command names a registry action,
 * `callAction` runs it, and `can()` decides exactly as it does for a click.
 * A router with its own permission table would be a second answer to "who may
 * do this", and the two would drift apart within a release.
 *
 * **Every inbound action is audited with the channel on it.** Not by this file:
 * the channel goes on the `ActionCallContext` and the Operation pipeline merges
 * it into the audit payload, once, for every action. §7's promise that "she
 * checked in from Slack" is answerable a quarter later cannot depend on forty
 * actions each remembering.
 */
import type { Pool } from "pg";
import { type ActionName, callAction } from "../actions/registry.ts";
import { OperationError } from "../operations/operation.ts";
import type { ChannelConnectionKey } from "./capabilities.ts";
import {
  type ChatCommand,
  helpText,
  incompleteText,
  parseCommand,
} from "./commands.ts";

export interface RouterRequest {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly provider: ChannelConnectionKey;
  /** The member `resolveInbound` resolved. Never taken from the message. */
  readonly memberId: string;
  /** The user behind that member, which is what `can()` resolves against. */
  readonly userId: string;
  readonly text: string;
  /** How this provider's own commands are written, for the help reply. */
  readonly prefix?: string;
  /**
   * The moment this arrived.
   *
   * Passed rather than read, because nothing in this product reads a clock
   * inside its own logic. `snooze` is arithmetic on it.
   */
  readonly now: Date;
}

export type RouterReply =
  /** Something to send back. Every branch has one: silence is for strangers. */
  | { readonly kind: "reply"; readonly text: string }
  /** The action ran. `text` is what the member reads about it. */
  | {
      readonly kind: "done";
      readonly text: string;
      readonly action: string;
    };

/**
 * What a member reads after an action they asked for succeeded.
 *
 * Deliberately thin. A per-action rendering of every result is the same problem
 * as per-rule nudge copy: it is the product's voice, and the product's voice
 * belongs in METHOD.md rather than scattered across a router. What this says is
 * true and small, and it names the action so the reply resolves back to one
 * contract.
 */
function doneText(command: ChatCommand): string {
  return `Done: ${command.summary.replace(/\.$/, "").toLowerCase()}.`;
}

/**
 * Runs one line of chat.
 *
 * Never throws for a refusal. A member who asked for something they may not
 * have gets a sentence, because by this point they are somebody the product
 * knows: §6's silence is for senders it does not.
 */
export async function routeCommand(
  request: RouterRequest,
): Promise<RouterReply> {
  const prefix = request.prefix ?? "/okr";
  const parsed = parseCommand(request.text);

  if (parsed.kind === "help") {
    return { kind: "reply", text: helpText(prefix) };
  }
  if (parsed.kind === "unknown") {
    // Names what is available rather than only what is wrong. A refusal that
    // says "unknown command" and stops is a dead end in a chat window.
    return {
      kind: "reply",
      text: [
        `I do not have a "${parsed.verb}" command.`,
        "",
        helpText(prefix),
      ].join("\n"),
    };
  }
  if (parsed.kind === "incomplete") {
    return {
      kind: "reply",
      text: incompleteText(parsed.command, parsed.missing, prefix),
    };
  }

  const { command, args } = parsed;
  try {
    const result = await callAction(
      {
        pool: request.pool,
        workspaceId: request.workspaceId,
        actor: { kind: "human", userId: request.userId },
        // The one line that makes every inbound write answerable later.
        channel: request.provider,
      },
      command.action as ActionName,
      command.toInput(args, request.now) as never,
    );
    return {
      kind: "done",
      action: command.action,
      text: replyFor(command, result),
    };
  } catch (error) {
    if (error instanceof OperationError) {
      // The sentence `packages/core` wrote for the browser, unchanged. §7: the
      // refusal is the same one the browser shows.
      return { kind: "reply", text: error.message };
    }
    // Not a refusal. Something broke, and a member should not read a stack
    // trace to find that out.
    return {
      kind: "reply",
      text: "Something went wrong on our side. Nothing was changed.",
    };
  }
}

/**
 * The answer a read command has, or the confirmation a write has.
 *
 * Two commands here answer with data a member actually wanted, so those two
 * are rendered; the rest confirm. Rendering is by shape rather than by a
 * per-action switch, so an action whose output grows a field does not silently
 * stop being rendered.
 */
function replyFor(command: ChatCommand, result: unknown): string {
  const record = result as Record<string, unknown>;

  if (command.verb === "status") {
    const title = typeof record.title === "string" ? record.title : "That goal";
    const parts = [
      typeof record.health === "string" ? `health ${record.health}` : null,
      typeof record.progress === "number"
        ? `${Math.round(record.progress)}% of the way`
        : null,
      typeof record.confidence === "number"
        ? `confidence ${record.confidence}`
        : null,
      typeof record.nextCheckInAt === "string"
        ? `next check-in ${record.nextCheckInAt.slice(0, 10)}`
        : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? `${title}: ${parts.join(", ")}.` : `${title}.`;
  }

  if (command.verb === "ask") {
    const answer = record.answer;
    if (typeof answer === "string" && answer.trim() !== "") {
      return answer;
    }
    // The copilot with no provider configured. Said plainly rather than as an
    // empty message, which reads as the product ignoring somebody.
    return "I have no language model configured, so I cannot answer that yet.";
  }

  return doneText(command);
}
