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
import { withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { type ActionName, callAction } from "../actions/registry.ts";
import { OperationError } from "../operations/operation.ts";
import { DEFAULT_CHAT_CONVERSATION_MINUTES } from "../settings/registry.ts";
import type { ChannelConnectionKey } from "./capabilities.ts";
import {
  beginCheckIn,
  CHECK_IN_COMMAND,
  continueCheckIn,
  type FlowRequest,
} from "./check-in-flow.ts";
import {
  type ChatCommand,
  helpText,
  incompleteText,
  parseCommand,
} from "./commands.ts";
import { runningSessionFor } from "./sessions.ts";

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
   * How long a half-finished conversation waits, from §4.14's setting
   * (P5-T06b).
   *
   * Passed in rather than read here, for the same reason `now` is: this file
   * decides what a message means, and a workspace's own settings are the
   * caller's to resolve.
   */
  readonly conversationMinutes?: number;
  /** The provider's thread, when it has one, so a reply resumes the right one. */
  readonly threadId?: string;
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
  const flow: FlowRequest = {
    pool: request.pool,
    workspaceId: request.workspaceId,
    provider: request.provider,
    memberId: request.memberId,
    userId: request.userId,
    now: request.now,
    minutes: request.conversationMinutes ?? DEFAULT_CHAT_CONVERSATION_MINUTES,
    ...(request.threadId ? { threadId: request.threadId } : {}),
  };

  const parsed = parseCommand(request.text);

  // **A message that is a command is a command, even mid-conversation.**
  // §8.1 says anything which is not an answer ends the conversation, and a
  // recognised command is exactly that: it ends it and then runs. The first
  // version tried to answer first, so somebody who typed `checkin` while a
  // check-in was already half finished had it abandoned *and* nothing started,
  // which is the worst of both.
  //
  // Anything else is read as an answer. "8" and "skip" are not commands, so a
  // member answering a question is never told there is no "8" command.
  const looksLikeCommand =
    parsed.kind === "command" || parsed.kind === "incomplete";
  if (!looksLikeCommand) {
    const answered = await continueCheckIn(flow, request.text);
    if (answered.kind !== "none") {
      return { kind: "reply", text: answered.text };
    }
  }

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

  // The two commands that need the session somebody is in (P5-T06c). Resolved
  // here rather than in the catalogue, because it is a query and `toInput` is
  // pure: parsed arguments and a moment, nothing that reads a database.
  const sessionBound = SESSION_BOUND[command.verb];
  if (sessionBound) {
    const lookup = await withWorkspace(
      drizzle(request.pool),
      request.workspaceId,
      (tx) =>
        runningSessionFor(tx, {
          workspaceId: request.workspaceId,
          memberId: request.memberId,
          ...(sessionBound.keyResultArg
            ? { keyResultId: args[sessionBound.keyResultArg] ?? "" }
            : {}),
        }),
    );
    if (lookup.kind !== "found") {
      // A member the product knows gets a sentence, not silence.
      return { kind: "reply", text: lookup.reason };
    }
    return runAction(request, command, {
      ...command.toInput(args, request.now),
      ...sessionBound.extra(lookup.sessionId, request.memberId, args),
    });
  }

  const ownerField = SENDER_OWNED[command.verb];
  if (ownerField) {
    return runAction(request, command, {
      ...command.toInput(args, request.now),
      [ownerField]: request.memberId,
    });
  }

  // The one command that is a conversation. Everything below it is a line.
  if (command.verb === CHECK_IN_COMMAND) {
    const begun = await beginCheckIn(flow, args.goal ?? "");
    return {
      kind: "reply",
      // `none` cannot happen for a start, and a fallback here rather than a
      // cast keeps the union honest if a fourth outcome is ever added.
      text: begun.kind === "none" ? "I could not start that." : begun.text,
    };
  }

  return runAction(request, command, command.toInput(args, request.now));
}

/**
 * How a session-bound command finds its session and shapes its input.
 *
 * A table rather than two branches, so a third one is a row: what the sender
 * names, and what the action needs beyond it. Both put the sender down as the
 * owner, because a blocker somebody raises is theirs and a commitment somebody
 * makes is theirs.
 */
const SESSION_BOUND: Readonly<
  Record<
    string,
    {
      readonly keyResultArg?: string;
      readonly extra: (
        sessionId: string,
        memberId: string,
        args: Readonly<Record<string, string>>,
      ) => Record<string, unknown>;
    }
  >
> = {
  blocker: {
    keyResultArg: "keyResult",
    extra: (sessionId, memberId) => ({ sessionId, ownerId: memberId }),
  },
  commit: {
    // Nothing named, so the lookup falls back to the one session running in a
    // space this member is in, and refuses when there is more than one.
    extra: (sessionId, memberId, args) => ({
      sessionId,
      // The action takes a list. One item, because a chat line is one
      // commitment and `setCommitments` appends rather than replacing.
      items: [{ text: args.text ?? "", ownerId: memberId }],
    }),
  },
};

/**
 * Commands whose action needs the sender as a member id (P5-T03b).
 *
 * Separate from `SESSION_BOUND` because there is no lookup: the sender is
 * already known and the only question is which field wants it. A command that
 * took a member id from the line would be a command for handing work to other
 * people from a phone, which is a board's job and not a chat line's.
 */
const SENDER_OWNED: Readonly<Record<string, string>> = {
  take: "ownerId",
};

/**
 * Calls one registry action and turns whatever happens into a reply.
 *
 * Extracted at the second caller: the session-bound commands build their input
 * from a query rather than from the catalogue alone, and everything after that
 * is identical. `can()` still decides, and the refusal is still the sentence the
 * browser shows.
 */
async function runAction(
  request: RouterRequest,
  command: ChatCommand,
  input: Record<string, unknown>,
): Promise<RouterReply> {
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
      input as never,
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
