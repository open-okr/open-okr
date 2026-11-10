/**
 * Running one tool call as one member (AI-NATIVE-PLAN.md §8.3, P5-T09b).
 *
 * **Two gates, and neither substitutes for the other.** The scope narrows what
 * a token reaches, and it is checked here, before the action runs. `can()`
 * decides whether that member reaches it at all, and it runs inside the action
 * exactly as it does for a click. A token with write scope held by a view-level
 * member writes nothing.
 *
 * **Every refusal is a result rather than a thrown error.** The protocol has
 * `isError` on a tool result precisely so an agent can read a denial and report
 * it. A thrown error reaches a client as a transport fault, which is a thing to
 * retry, and an agent retrying a permission denial is an agent that looks broken
 * to the person watching it.
 *
 * **A refusal says what was wrong and nothing more.** "This token has read
 * scope, and goals.create needs write" is what a person debugging their agent
 * needs. What it never carries is anything about the shape of a workspace the
 * caller cannot see: a not-found stays not-found.
 */

import { aiToolCalls, type ToolCallOutcome, withWorkspace } from "@openokr/db";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { ZodError } from "zod";
import { ACCESS_LEVELS } from "../../access/levels.ts";
import { type ActionName, callAction } from "../../actions/registry.ts";
import { ScopeCeilingRefused } from "../../actions/scope-ceiling.ts";
import { OperationError } from "../../operations/errors.ts";
import { runOperation } from "../../operations/operation.ts";
import { richTextFromPlainText } from "../../rich-text/from-text.ts";
import type { KeyRing } from "../../secrets/key-ring.ts";
import { defaultMetrics, METRIC } from "../../telemetry/recorder.ts";
import { errorFor } from "../errors.ts";
import { isRichTextField, SERVER_SET_FIELDS, toolNamed } from "./catalogue.ts";
import { isResearchTool, runResearchTool } from "./research.ts";
import type { ToolsetName } from "./toolset-data.ts";
import { toolsetRefusal } from "./toolsets.ts";

export interface DispatchPrincipal {
  readonly workspaceId: string;
  readonly userId: string;
  /** What the grant carries. A tool needing more than this is refused here. */
  readonly scopes: readonly string[];
  /**
   * The instance's own base URL, when the transport knows it (P5-T09c).
   *
   * Only `fetch` and `search` read it, and only to build a citation somebody can
   * open. Absent is correct and the address falls back to the `openokr://` form.
   */
  readonly instanceUrl?: string;
  /**
   * The toolsets the connection chose (docs/design/mcp-toolsets.md). Absent
   * means every toolset, which is what a caller other than the transport,
   * such as a test, wants.
   */
  readonly toolsets?: ReadonlySet<ToolsetName>;
  /**
   * The member the agent acts as and the connection it came through, so each
   * call can be recorded (agent-tool-calls.md, plan 0.7.0 A2). Absent for a
   * caller other than the transport, such as a test, and nothing is recorded.
   */
  readonly memberId?: string;
  readonly connection?:
    | { readonly grantId: string }
    | { readonly tokenId: string };
}

export interface DispatchResult {
  readonly text: string;
  readonly isError: boolean;
}

const refusal = (text: string): DispatchResult => ({ text, isError: true });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ids a call named: its top-level input values that are UUIDs, at most
 * five (agent-tool-calls.md D3). Which goal an agent read, never what it read.
 */
function targetIdsOf(input: Record<string, unknown>): string[] {
  return Object.values(input)
    .filter(
      (value): value is string => typeof value === "string" && UUID.test(value),
    )
    .slice(0, 5);
}

/** The record's row, or null when the caller is not the transport. */
function toolCallRow(
  principal: DispatchPrincipal,
  call: {
    readonly outcome: ToolCallOutcome;
    readonly tool?: string;
    readonly scope?: string;
    readonly refusalCode?: "forbidden" | "not_found" | "conflict";
    readonly targetIds: readonly string[];
    readonly durationMs: number;
  },
) {
  if (!principal.memberId || !principal.connection) {
    return null;
  }
  return {
    workspaceId: principal.workspaceId,
    memberId: principal.memberId,
    ...("grantId" in principal.connection
      ? { grantId: principal.connection.grantId }
      : { tokenId: principal.connection.tokenId }),
    tool: call.tool ?? null,
    scope: (call.scope ?? null) as "read" | "write" | "destructive" | null,
    outcome: call.outcome,
    refusalCode: call.refusalCode ?? null,
    targetIds: [...call.targetIds],
    durationMs: call.durationMs,
  };
}

/**
 * Records one call (agent-tool-calls.md D5, D6, D7; Akmal approved the
 * exception on 9 November 2026).
 *
 * **Outside the Operation pipeline, on purpose.** A record that a call
 * happened decides nothing, and through the pipeline every read would become
 * an activity and an audit row that no retention could ever prune, and a
 * frozen workspace would refuse the record. It is written there too (D7).
 * A failed insert is counted and never changes the answer.
 */
async function recordToolCall(
  pool: Pool,
  principal: DispatchPrincipal,
  call: {
    readonly run: ToolRun;
    readonly input: Record<string, unknown>;
    readonly durationMs: number;
  },
): Promise<void> {
  const row = toolCallRow(principal, {
    outcome: call.run.outcome,
    ...(call.run.tool
      ? { tool: call.run.tool.name, scope: call.run.tool.scope }
      : {}),
    ...(call.run.refusalCode ? { refusalCode: call.run.refusalCode } : {}),
    targetIds: targetIdsOf(call.input),
    durationMs: call.durationMs,
  });
  if (!row) {
    return;
  }
  try {
    // openokr:allow-mutation: an operational record outside the pipeline,
    // approved for A2 (D5): one insert, its own transaction, never a write
    // anything decides on.
    await withWorkspace(drizzle(pool), principal.workspaceId, (tx) =>
      tx.insert(aiToolCalls).values(row),
    );
  } catch {
    defaultMetrics().count(METRIC.agentToolCallRecordFailures, {});
  }
}

/**
 * Writes down that a connection asked for more than it was granted
 * (agent-surface.md's acceptance: "the denial is audited", plan 0.7.0 A3).
 *
 * Through the pipeline, like `recordAIEgressWithheld`: an audit row naming the
 * member whose agent asked, the tool, the scope it needed and the scopes it
 * holds, with the channel merged in as on every write from an agent. The
 * activity is private, so a retrying agent cannot fill the workspace feed.
 *
 * **Never in the way of the answer.** A frozen workspace refuses the write and
 * a member who has left cannot be resolved; either way the agent still gets
 * the refusal it would have got, and nothing is recorded.
 */
async function auditScopeRefusal(
  pool: Pool,
  principal: DispatchPrincipal,
  tool: string,
  needed: string,
  record: {
    readonly targetIds: readonly string[];
    readonly durationMs: number;
  },
): Promise<void> {
  try {
    await runOperation(
      { pool },
      {
        action: "agent.scope_refused",
        workspaceId: principal.workspaceId,
        actor: { kind: "human", userId: principal.userId },
        requires: ACCESS_LEVELS.view,
        channel: "mcp",
        async execute({ tx, workspaceId }) {
          // The call's own record commits with the audit row (A2's D8).
          const row = toolCallRow(principal, {
            outcome: "refused_scope",
            tool,
            scope: needed,
            targetIds: record.targetIds,
            durationMs: record.durationMs,
          });
          if (row) {
            // openokr:allow-mutation: the refusal Operation's own transaction.
            await tx.insert(aiToolCalls).values(row);
          }
          return {
            result: undefined,
            activity: {
              kind: "agent.scope_refused",
              subjectType: "workspace",
              subjectId: workspaceId,
              payload: { tool, needed },
            },
            audit: {
              action: "agent.scope_refused",
              targetType: "workspace",
              targetId: workspaceId,
              payload: { tool, needed, granted: [...principal.scopes] },
            },
          };
        },
      },
    );
  } catch {
    // Recorded where it can be; the refusal is the answer either way.
  }
}

/**
 * Runs one tool, or says why not.
 *
 * The `channel` on the call is what puts "this came from an external agent" on
 * the audit row, once, for every action rather than per action.
 */
/** Where one call stopped, for its record (agent-tool-calls.md §2.1). */
interface ToolRun {
  readonly result: DispatchResult;
  readonly outcome: ToolCallOutcome;
  readonly refusalCode?: "forbidden" | "not_found" | "conflict";
  /** The catalogue's own tool, when there is one. */
  readonly tool?: { readonly name: string; readonly scope: string };
}

/**
 * Runs one tool call as an external agent, and records it.
 *
 * The record (plan 0.7.0 A2) is one marked insert after the call, never in
 * the agent's way: a failed insert is counted and the answer is unchanged
 * (D6). A scope refusal's record is written inside A3's audit Operation, so
 * the two commit together (D8).
 */
export async function dispatchTool(
  pool: Pool,
  principal: DispatchPrincipal,
  name: string,
  input: Record<string, unknown>,
  ring?: KeyRing,
): Promise<DispatchResult> {
  const startedAt = performance.now();
  const run = await runTool(pool, principal, name, input, ring, startedAt);
  if (run.outcome !== "refused_scope") {
    await recordToolCall(pool, principal, {
      run,
      input,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
  return run.result;
}

async function runTool(
  pool: Pool,
  principal: DispatchPrincipal,
  name: string,
  input: Record<string, unknown>,
  ring: KeyRing | undefined,
  startedAt: number,
): Promise<ToolRun> {
  const tool = toolNamed(name);
  if (!tool) {
    return {
      result: refusal(`There is no tool called "${name}".`),
      outcome: "unknown_tool",
    };
  }
  const known = { name: tool.name, scope: tool.scope };

  // Before the scope gate, so a tool outside the chosen toolsets says where
  // it lives rather than which scope it needs.
  const outside = principal.toolsets
    ? toolsetRefusal(name, principal.toolsets)
    : null;
  if (outside) {
    return {
      result: refusal(outside),
      outcome: "outside_toolsets",
      tool: known,
    };
  }

  if (!principal.scopes.includes(tool.scope)) {
    await auditScopeRefusal(pool, principal, name, tool.scope, {
      targetIds: targetIdsOf(input),
      durationMs: Math.round(performance.now() - startedAt),
    });
    // Before the action runs, and named, because a person debugging their agent
    // needs to know which scope to ask for next time.
    return {
      result: refusal(
        `That connection has ${principal.scopes.join(" and ")} scope, and ${name} needs ${tool.scope}.`,
      ),
      outcome: "refused_scope",
      tool: known,
    };
  }

  const serverSet = SERVER_SET_FIELDS.filter((field) => field in input);
  if (serverSet.length > 0) {
    // Not in the schema the agent was shown, so sending one is a mistake or a
    // probe; either way nothing runs.
    return {
      result: refusal(
        `${serverSet.join(" and ")} is set by the server, not by an agent. Leave it out.`,
      ),
      outcome: "invalid_input",
      tool: known,
    };
  }

  // An agent writes a sentence where a document is wanted, and the catalogue
  // told it that it may. Only this path converts; REST and the command line
  // refuse plain text (guided-inputs.md change 13b).
  const converted = Object.fromEntries(
    Object.entries(input).map(([field, value]) => [
      field,
      typeof value === "string" && isRichTextField(tool.inputSchema, field)
        ? richTextFromPlainText(value)
        : value,
    ]),
  );
  input = converted;

  try {
    // The two tools that are not registry actions run here, after the same
    // scope gate and inside the same catch, so a refusal from either reads the
    // way a refusal from any other tool reads.
    if (isResearchTool(tool.name)) {
      const answer = await runResearchTool(
        pool,
        {
          workspaceId: principal.workspaceId,
          userId: principal.userId,
          ...(principal.instanceUrl
            ? { instanceUrl: principal.instanceUrl }
            : {}),
          ...(ring ? { ring } : {}),
        },
        tool.name,
        input,
      );
      return {
        result: { text: JSON.stringify(answer ?? null), isError: false },
        outcome: "ok",
        tool: known,
      };
    }

    const result = await callAction(
      {
        pool,
        workspaceId: principal.workspaceId,
        actor: { kind: "human", userId: principal.userId },
        // Recorded on every audit row this call writes, so "an agent did this"
        // is answerable a quarter later.
        channel: "mcp",
        // The connection's scopes, as a ceiling for every action the tool
        // causes (token-scope-ceiling.md).
        scopes: principal.scopes,
        ...(ring ? { ring } : {}),
      },
      name as ActionName,
      input as never,
    );
    return {
      result: { text: JSON.stringify(result ?? null), isError: false },
      outcome: "ok",
      tool: known,
    };
  } catch (error) {
    if (error instanceof ScopeCeilingRefused) {
      // An action the tool caused that the connection's scopes do not reach,
      // recorded as a scope refusal at the door is (A3, design C5), naming
      // the nested action.
      await auditScopeRefusal(pool, principal, error.action, error.needs, {
        targetIds: targetIdsOf(input),
        durationMs: Math.round(performance.now() - startedAt),
      });
      return {
        result: refusal(error.message),
        outcome: "refused_scope",
        tool: known,
      };
    }
    if (error instanceof ZodError) {
      // **An input the schema refuses is a refusal, and it names the fields.**
      // Until P5-T16 a read never got here, because the read builder did not
      // parse; a wrong-shaped identifier reached the database and came back as
      // a fault, and an agent reading "that could not be completed" retries the
      // same call. Naming the field leaks nothing: the same schema is published
      // in the tool catalogue the agent read to make the call.
      const { fields } = errorFor(error);
      const named = Object.entries(fields ?? {})
        .map(([field, message]) => `${field}: ${message}`)
        .join("; ");
      return {
        result: refusal(
          named
            ? `That input is not valid. ${named}`
            : "That input is not valid.",
        ),
        outcome: "invalid_input",
        tool: known,
      };
    }
    if (error instanceof OperationError) {
      // The browser's own sentence, unchanged. A not-found stays not-found, so
      // a probe learns nothing about what exists in a workspace it cannot see.
      return {
        result: refusal(error.message),
        outcome: "refused",
        refusalCode: error.code,
        tool: known,
      };
    }
    // Anything else is a fault rather than a refusal, and saying so plainly is
    // better than handing an agent a stack trace to reason about.
    return {
      result: refusal("That call could not be completed."),
      outcome: "failed",
      tool: known,
    };
  }
}

/**
 * Reads one resource by the URI an agent asked for.
 *
 * A resource is an action with a friendlier address. Nothing here is a second
 * read path: the named action runs through `dispatchTool` and is filtered by
 * the same access layer as every other read.
 */
export async function dispatchResource(
  pool: Pool,
  principal: DispatchPrincipal,
  uri: string,
  resources: readonly {
    readonly uriTemplate: string;
    readonly action: string;
    readonly binds: Readonly<Record<string, string>>;
  }[],
  ring?: KeyRing,
): Promise<DispatchResult> {
  for (const resource of resources) {
    const bound = matchTemplate(resource.uriTemplate, uri);
    if (bound) {
      // The template's variable names are the address's; the action's are its
      // own. The resource declares which fills which, so neither has to be
      // named after the other.
      const input: Record<string, unknown> = {};
      for (const [variable, field] of Object.entries(resource.binds)) {
        const value = bound[variable];
        if (value !== undefined) {
          input[field] = value;
        }
      }
      return dispatchTool(pool, principal, resource.action, input, ring);
    }
  }
  return refusal(`There is no resource at "${uri}".`);
}

/**
 * The variables one URI binds, or null when the template does not match.
 *
 * A deliberately small reader of RFC 6570: every template here is a literal
 * path with one `{name}` in it, and a general expander would be a parser this
 * product has no other use for.
 */
export function matchTemplate(
  template: string,
  uri: string,
): Record<string, string> | null {
  const names: string[] = [];
  const pattern = template.replace(
    /\{([A-Za-z][A-Za-z0-9_]*)\}|[.*+?^${}()|[\]\\]/g,
    (match, name?: string) => {
      if (name) {
        names.push(name);
        return "([^/]+)";
      }
      return `\\${match}`;
    },
  );

  const found = new RegExp(`^${pattern}$`).exec(uri);
  if (!found) {
    return null;
  }

  const bound: Record<string, string> = {};
  names.forEach((name, index) => {
    const value = found[index + 1];
    if (value !== undefined) {
      bound[name] = decodeURIComponent(value);
    }
  });
  return bound;
}
