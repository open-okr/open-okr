/**
 * How an action is declared (TECHNICAL-PLAN §14).
 *
 * Two builders, and the difference between them is the point. A read action
 * gets a plain handler. A write action gets an *operation spec* instead of a
 * handler, and the builder runs it through the pipeline. There is no way to
 * declare a write that skips the audit row, because the shape that would
 * express it does not exist.
 */

import type { Pool } from "pg";
import type { ZodType } from "zod";
import type { AccessLevel } from "../access/levels.ts";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  type ActorInput,
  type OperationSpec,
  runOperation,
} from "../operations/operation.ts";

/** Read, write, or write that removes something a person can see. */
export type SafetyClass = "read" | "write" | "destructive";

/** What every action needs to run: the database and who is asking. */
export interface ActionCallContext {
  readonly pool: Pool;
  readonly workspaceId: string;
  readonly actor: ActorInput;
}

export interface ActionDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly summary: string;
  readonly input: ZodType<TInput>;
  readonly output: ZodType<TOutput>;
  readonly access: AccessLevel;
  readonly safety: SafetyClass;
  /** True when the handler is built from an operation spec. */
  readonly runsThroughPipeline: boolean;
  handler(context: ActionCallContext, input: TInput): Promise<TOutput>;
}

/**
 * A read action. Its handler may query, and the mutation lint stops it
 * writing.
 */
export function defineReadAction<TInput, TOutput>(definition: {
  name: string;
  summary: string;
  input: ZodType<TInput>;
  output: ZodType<TOutput>;
  access?: AccessLevel;
  handler(context: ActionCallContext, input: TInput): Promise<TOutput>;
}): ActionDefinition<TInput, TOutput> {
  return {
    ...definition,
    access: definition.access ?? ACCESS_LEVELS.view,
    safety: "read",
    runsThroughPipeline: false,
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
      return runOperation<TOutput, TLoaded>(
        { pool: context.pool },
        {
          ...definition.operation(context, input),
          action: definition.name,
          workspaceId: context.workspaceId,
          actor: context.actor,
        },
      );
    },
  };
}
