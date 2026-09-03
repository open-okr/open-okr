/**
 * How an action is declared (TECHNICAL-PLAN §14).
 *
 * Two builders, and the difference between them is the point. A read action
 * gets a handler. A write action gets an *operation spec* instead, and the
 * builder runs it through the pipeline. There is no way to declare a write that
 * skips the audit row, because the shape that would express it does not exist.
 *
 * Both parse their declared input before anything else runs, so no surface can
 * reach a handler with a shape the contract does not describe.
 */

import type { Pool } from "pg";
import type { ZodType } from "zod";
import type { AccessLevel } from "../access/levels.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import type { AgentDrafter } from "../agents/drafter.ts";
import type { EmbedFunction } from "../embeddings/service.ts";
import {
  type ActorInput,
  type OperationSpec,
  runOperation,
} from "../operations/operation.ts";
import type { KeyRing } from "../secrets/key-ring.ts";

/** Read, write, or write that removes something a person can see. */
export type SafetyClass = "read" | "write" | "destructive";

/**
 * How a read action pages, when it does (P5-T07a).
 *
 * Declared here rather than inferred, and only by an action that genuinely
 * takes a cursor. The public surface builds the next cursor from the fields
 * named below and refuses a cursor on an action that declares nothing, instead
 * of loading everything and slicing it in the transport. Paging in the
 * transport is not paging: it costs the same query and tells the caller it did
 * not.
 */
export interface PageContract {
  /**
   * Fields of the last returned item that make up the next cursor.
   *
   * The cursor is opaque to clients, so this can change without a version.
   */
  readonly cursorFrom: readonly string[];
  /**
   * Where the array sits in the output, when the output is an object wrapping
   * it. Absent when the output is the array itself.
   */
  readonly itemsAt?: string;
}

/** What every action needs to run: the database and who is asking.
 * `ring` is optional because only the handful of actions that seal or open a
 * credential need it (P2-T14 onward) — every other action's context stays
 * exactly as it was. A caller that omits it and reaches one of those
 * actions gets a clear error from the action itself, not a silent no-op. */
export interface ActionCallContext {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly actor: ActorInput;
  readonly ring?: KeyRing;
  /**
   * Language for the agents, when the host has a provider to give (P4-T05c-b).
   *
   * Absent is the normal case and means the AI provider is off. Every trigger,
   * ladder, gate and corridor works without it; it adds wording to a proposal
   * and never decides that the proposal should exist.
   */
  readonly drafter?: AgentDrafter;
  /**
   * How to turn text into a vector, when the host has a provider that can
   * (P4-T14a-a).
   *
   * Separate from `drafter` because they fail separately. Without this,
   * retrieval takes the full-text path, which is AI-NATIVE-PLAN §2.4's own
   * degradation and still answers. Without the drafter there is no prose. A
   * workspace can have one and not the other.
   */
  readonly embed?: EmbedFunction;
  /**
   * Where this call came from, when it did not come from the browser
   * (P5-T06a).
   *
   * Set by the chat router and by nothing else. It reaches the audit row
   * through the Operation pipeline, in one place, so that every inbound action
   * is answerable a quarter later without each action having to remember.
   */
  readonly channel?: string;
}

export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly summary: string;
  readonly input: ZodType<TInput>;
  readonly output: ZodType<TOutput>;
  readonly access: AccessLevel;
  readonly safety: SafetyClass;
  /** Set when this action takes a cursor. Reads only. */
  readonly page?: PageContract;
  /** True when the handler is built from an operation spec. */
  readonly runsThroughPipeline: boolean;
  handler(context: ActionCallContext, input: TInput): Promise<TOutput>;
}

/**
 * A read action. Its handler may query, and the mutation lint stops it
 * writing.
 *
 * The input is parsed before the handler runs, the same way the write builder
 * parses before its operation opens a transaction (§8.2, "validate at the
 * boundary"). Until P5-T16 it was not, and the asymmetry was invisible because
 * the typed internal client keeps its own callers honest at compile time. The
 * other callers are text: REST assembles a read's input out of query strings,
 * the agent transport out of a tool call, the chat router out of a message.
 * Each of those could hand a read a number where it declared a string, or a
 * key it never declared, and the handler would carry it into SQL.
 */
export function defineReadAction<TInput, TOutput>(definition: {
  name: string;
  summary: string;
  input: ZodType<TInput>;
  output: ZodType<TOutput>;
  access?: AccessLevel;
  /** Declare this only if the input really takes a cursor. */
  page?: PageContract;
  handler(context: ActionCallContext, input: TInput): Promise<TOutput>;
}): ActionDefinition<TInput, TOutput> {
  return {
    ...definition,
    access: definition.access ?? ACCESS_LEVELS.view,
    safety: "read",
    runsThroughPipeline: false,
    // Declared after the spread, so it wraps the handler the caller passed
    // rather than being replaced by it.
    async handler(context, rawInput) {
      const input = definition.input.parse(rawInput);
      return definition.handler(context, input);
    },
  };
}

/**
 * A write action, built from an operation spec rather than a handler.
 *
 * The input is parsed before the operation opens its transaction, so invalid
 * input never reaches a write path (§8.2, "validate at the boundary").
 */
export function defineWriteAction<
  TInput,
  TOutput,
  TLoaded = undefined,
>(definition: {
  name: string;
  summary: string;
  input: ZodType<TInput>;
  output: ZodType<TOutput>;
  access?: AccessLevel;
  safety?: Extract<SafetyClass, "write" | "destructive">;
  operation(
    context: ActionCallContext,
    input: TInput,
  ): Omit<OperationSpec<TOutput, TLoaded>, "action" | "workspaceId" | "actor">;
}): ActionDefinition<TInput, TOutput> {
  return {
    name: definition.name,
    summary: definition.summary,
    input: definition.input,
    output: definition.output,
    access: definition.access ?? ACCESS_LEVELS.edit,
    safety: definition.safety ?? "write",
    runsThroughPipeline: true,
    async handler(context, rawInput) {
      const input = definition.input.parse(rawInput);
      const spec = definition.operation(context, input);
      return runOperation<TOutput, TLoaded>(
        { pool: context.pool },
        {
          ...spec,
          // The level this action was declared with is the level
          // `runOperation` actually enforces. Before this line it fell back
          // to its own `edit` default instead, silently under-enforcing
          // every write action across Phase 2 that declares `full` (rename,
          // suspend, restore, convert-to-guest, erase, invitation create and
          // revoke) — an `edit`-level member could reach all of them. An
          // `operation()` callback that sets `requires` itself, for a
          // resource-level rule finer than one flat number, still wins.
          requires: spec.requires ?? definition.access ?? ACCESS_LEVELS.edit,
          action: definition.name,
          workspaceId: context.workspaceId,
          actor: context.actor,
          // Carried from the call context, so an action reached from chat is
          // audited with the channel on it without the action knowing there
          // are channels (P5-T06a). Absent for a browser call.
          ...(context.channel ? { channel: context.channel } : {}),
        },
      );
    },
  };
}
