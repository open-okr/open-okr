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
import type { Pool } from "pg";
import { type ActionName, callAction } from "../../actions/registry.ts";
import { OperationError } from "../../operations/errors.ts";
import type { KeyRing } from "../../secrets/key-ring.ts";
import { toolNamed } from "./catalogue.ts";
import { isResearchTool, runResearchTool } from "./research.ts";

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
}

export interface DispatchResult {
  readonly text: string;
  readonly isError: boolean;
}

const refusal = (text: string): DispatchResult => ({ text, isError: true });

/**
 * Runs one tool, or says why not.
 *
 * The `channel` on the call is what puts "this came from an external agent" on
 * the audit row, once, for every action rather than per action.
 */
export async function dispatchTool(
  pool: Pool,
  principal: DispatchPrincipal,
  name: string,
  input: Record<string, unknown>,
  ring?: KeyRing,
): Promise<DispatchResult> {
  const tool = toolNamed(name);
  if (!tool) {
    return refusal(`There is no tool called "${name}".`);
  }

  if (!principal.scopes.includes(tool.scope)) {
    // Before the action runs, and named, because a person debugging their agent
    // needs to know which scope to ask for next time.
    return refusal(
      `That connection has ${principal.scopes.join(" and ")} scope, and ${name} needs ${tool.scope}.`,
    );
  }

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
      return { text: JSON.stringify(answer ?? null), isError: false };
    }

    const result = await callAction(
      {
        pool,
        workspaceId: principal.workspaceId,
        actor: { kind: "human", userId: principal.userId },
        // Recorded on every audit row this call writes, so "an agent did this"
        // is answerable a quarter later.
        channel: "mcp",
        ...(ring ? { ring } : {}),
      },
      name as ActionName,
      input as never,
    );
    return { text: JSON.stringify(result ?? null), isError: false };
  } catch (error) {
    if (error instanceof OperationError) {
      // The browser's own sentence, unchanged. A not-found stays not-found, so
      // a probe learns nothing about what exists in a workspace it cannot see.
      return refusal(error.message);
    }
    // Anything else is a fault rather than a refusal, and saying so plainly is
    // better than handing an agent a stack trace to reason about.
    return refusal("That call could not be completed.");
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
