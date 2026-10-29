/**
 * The tool catalogue an external agent is offered (AI-NATIVE-PLAN.md §8.3,
 * P5-T09a).
 *
 * **A third projection of the one registry, beside the OpenAPI document and the
 * command line.** Every tool is an action; its input schema is the action's own
 * Zod schema converted; its scope is the action's safety class. Nothing here
 * decides what an agent may do: `can()` decides, exactly as it does for a click,
 * and the scope narrows what a token reaches before that. A hand-written
 * catalogue would be a fourth copy of the surface with a fourth chance to
 * disagree.
 *
 * **The safety class becomes two things at once, and both matter.** It is the
 * scope a token needs, which is enforcement, and it is the hint a client shows a
 * person before they approve a call, which is not. An agent runtime that reads
 * `readOnlyHint` decides whether to ask; the server decides whether to answer.
 * Losing either is a real failure, which is why an invariant test pins both.
 *
 * **Destructive is named as destructive, and is in the catalogue.** Leaving
 * deletions out would make the surface look safer than it is while an agent
 * reached them through the REST endpoint anyway. What protects somebody is that
 * the scope is separate, the grant has to carry it, and the client is told.
 */
import { type ZodType, z } from "zod";
import type { JsonObject } from "../openapi.ts";
import { REST_ROUTES, type RestRoute } from "../surface.ts";
import { RESEARCH_TOOL_SPECS, type ResearchToolSpec } from "./research.ts";

/** The catalogue's own version, bumped when its shape changes. */
export const CATALOGUE_VERSION = 1;

export interface McpTool {
  /** What an agent calls. Dots, as the registry names it: `goals.list`. */
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  /** Which scope a grant must carry. The action's own safety class. */
  readonly scope: string;
  /**
   * The protocol's own annotations (`ToolAnnotations`).
   *
   * `readOnlyHint` and `destructiveHint` are what a client shows a person
   * before it lets an agent call something. They are hints in the
   * specification's own words, and hints here too: nothing on the server reads
   * them to decide anything.
   */
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    /** True when calling twice is the same as calling once. */
    readonly idempotentHint: boolean;
  };
  /** One call an agent can copy. Generated, so it cannot go stale. */
  readonly example: JsonObject;
}

export interface McpResource {
  /** A template in RFC 6570 form, which is what the protocol takes. */
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
  /** The action a read of this resource runs. */
  readonly action: string;
  /**
   * Which of the action's input fields the template's variable fills.
   *
   * Declared rather than inferred from the variable's name. A template reads
   * better as `{goalId}` than as `{id}`, and an address that has to be named
   * after a field is an address that changes when the field is renamed. This is
   * one line and a test walks it against the registry.
   */
  readonly binds: Readonly<Record<string, string>>;
}

export interface McpPrompt {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
  }[];
  /**
   * The message `prompts/get` answers with: the starting question, and which
   * tools answer it. A client lists the prompts and then asks for one, and a
   * server that could list but not answer told every client "method not
   * found" (MCP Inspector against the UAT instance, 13 October 2026).
   */
  readonly render: (args: Readonly<Record<string, string>>) => string;
}

export interface McpCatalogue {
  readonly version: number;
  readonly tools: readonly McpTool[];
  readonly resources: readonly McpResource[];
  readonly prompts: readonly McpPrompt[];
}

function jsonSchema(schema: ZodType): JsonObject {
  const converted = z.toJSONSchema(schema, {
    io: "input",
    // The same reason the OpenAPI generator does it: one unrepresentable field
    // must not take the whole catalogue down, because the catalogue is the only
    // place an agent can learn about the other three hundred tools.
    unrepresentable: "any",
    target: "draft-2020-12",
  }) as JsonObject;
  const { $schema, ...rest } = withoutUuidPatterns(converted) as JsonObject;
  // **The protocol requires an object at the top** (`type: "object"`), and a
  // client built on the official SDK validates every tool of a list against
  // that. An input that is a union of objects converts to a bare `anyOf`, and
  // one such tool made the whole list unreadable to those clients (found by
  // the MCP test against the UAT instance, 9 October 2026). The union stays
  // as it is, under an object type it already satisfies.
  return rest.type === "object" ? rest : { type: "object", ...rest };
}

/**
 * Drops the regular expression Zod writes beside every `format: "uuid"`.
 *
 * Every client loads every schema into the model's context, and that one
 * pattern, repeated on each identifier, was 60 KB of a 429 KB catalogue and
 * nearly a third of the default toolset (mcp-tool-review, 29 October 2026). The
 * format already says what the field is, and the server still validates every
 * call against the action's Zod schema, so nothing is accepted that was not.
 */
function withoutUuidPatterns(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(withoutUuidPatterns);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const record = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "pattern" && record.format === "uuid") {
      continue;
    }
    out[key] = withoutUuidPatterns(value);
  }
  return out;
}

/**
 * One call an agent can copy, built from the schema's own required fields.
 *
 * Generated rather than written, for the same reason the help text is: an
 * example somebody typed is an example that goes stale the first time a field
 * is renamed, and nothing would catch it.
 */
function exampleFor(schema: JsonObject): JsonObject {
  const properties = (schema.properties ?? {}) as Record<string, JsonObject>;
  const required = (schema.required ?? []) as string[];
  const example: JsonObject = {};

  for (const name of required) {
    const field = properties[name];
    if (!field) {
      continue;
    }
    example[name] = placeholderFor(field);
  }
  return example;
}

function placeholderFor(field: JsonObject): unknown {
  const enumValues = field.enum as unknown[] | undefined;
  if (enumValues && enumValues.length > 0) {
    return enumValues[0];
  }
  switch (field.type) {
    case "string":
      return field.format === "uuid"
        ? "00000000-0000-4000-8000-000000000000"
        : "…";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    default:
      return {};
  }
}

/**
 * Whether calling this twice is the same as calling it once.
 *
 * Read from the safety class rather than declared per action: every read is
 * idempotent by definition, and no write in this registry claims to be. An
 * action that genuinely is would need to say so, and none does yet.
 */
const idempotent = (route: RestRoute) => route.safety === "read";

function toolFor(route: RestRoute): McpTool {
  const schema = jsonSchema(route.inputSchema);
  return {
    name: route.action,
    description: route.summary,
    inputSchema: schema,
    scope: route.scope,
    annotations: {
      readOnlyHint: route.safety === "read",
      destructiveHint: route.safety === "destructive",
      idempotentHint: idempotent(route),
    },
    example: exampleFor(schema),
  };
}

/**
 * The read-only handles §8.3 names.
 *
 * Each one is an action the registry already has, addressed as a URI so an
 * agent can hold a reference to a thing rather than a call. Nothing here is a
 * second read path: a resource read runs the named action and is filtered by
 * the same access layer.
 */
export const MCP_RESOURCES: readonly McpResource[] = [
  {
    uriTemplate: "openokr://goal/{goalId}",
    name: "Goal",
    description: "One goal, with its key results and current health.",
    mimeType: "application/json",
    action: "goals.read",
    binds: { goalId: "id" },
  },
  {
    uriTemplate: "openokr://cycle/{cycleId}",
    name: "Cycle",
    description: "One cycle, with its phase and its dates.",
    mimeType: "application/json",
    action: "cycles.list",
    // Answers the workspace's cycles; the identifier in the address is what a
    // client holds a reference by, and the list is filtered on the way out.
    binds: {},
  },
  {
    uriTemplate: "openokr://scorecard/{memberId}",
    name: "Scorecard",
    description: "One member's scorecard for the current cycle.",
    mimeType: "application/json",
    action: "cycles.scorecard",
    binds: {},
  },
  {
    uriTemplate: "openokr://kpi-tree/{kpiId}",
    name: "KPI tree",
    description: "One KPI and the tree beneath it, with health corridors.",
    mimeType: "application/json",
    action: "kpis.tree",
    binds: { kpiId: "treeId" },
  },
  {
    uriTemplate: "openokr://work-map/{spaceId}",
    name: "Work Map slice",
    description: "The goals and initiatives in one space.",
    mimeType: "application/json",
    action: "goals.list",
    binds: { spaceId: "spaceId" },
  },
];

/**
 * The server-side templates §8.3 names.
 *
 * Deliberately thin, and deliberately not coaching copy: each one is a starting
 * question an agent asks its own model, and METHOD.md owns what the product
 * says to a person. A prompt that carried a rule's wording would be that
 * wording living outside the one document allowed to hold it.
 */
export const MCP_PROMPTS: readonly McpPrompt[] = [
  {
    name: "weekly-check-in",
    description: "Walk me through my check-ins that are due this week.",
    arguments: [],
    render: () =>
      [
        "Walk me through my check-ins that are due this week, one goal at a time.",
        "",
        "1. Call goals.list with mine set to true to find the goals I champion.",
        "2. For each one, call goals.read for its key results, their current values and the next check-in date. Skip a goal that is not due in the next seven days.",
        "3. For each goal that is due, ask me for every key result's new value, my confidence from 0 to 10, a status (on track, at risk or off track) and one sentence on what changed.",
        "4. Show me the check-in before you publish it with goals.publishCheckIn, and wait for my yes.",
        "",
        "Never invent a number. If I do not know a value, leave it as it is.",
      ].join("\n"),
  },
  {
    name: "review-against-the-canon",
    description:
      "Review this cycle's objectives against the quality checks and report what fails.",
    arguments: [
      {
        name: "cycleId",
        description: "The cycle to review. Defaults to the current one.",
        required: false,
      },
    ],
    render: (args) =>
      [
        "Review this cycle's objectives against the product's quality checks, and tell me what fails.",
        "",
        args.cycleId
          ? `1. Call workflow.read for the cycle ${args.cycleId}.`
          : "1. Call cycles.current, then workflow.read for that cycle.",
        "2. Publish gate 2 names every objective and key result that fails a check. For each, call goals.read and quote the check exactly as the product words it.",
        "3. Suggest one rewrite per failure, and list the failures by objective, the ones that block publishing first.",
        "",
        "Change nothing. This is a review.",
      ].join("\n"),
  },
  {
    name: "prepare-my-review",
    description: "Gather what I need for my quarterly review conversation.",
    arguments: [],
    render: () =>
      [
        "Gather what I need for my quarterly review conversation.",
        "",
        "1. Call sessions.mine to find my next quarterly review.",
        "2. Call goals.list with mine set to true, then goals.read for each, for every key result's latest value, confidence and check-ins.",
        "3. Call blockers.board for the blockers on those key results.",
        "4. For each objective, tell me where it ended, the score I could propose with one line of evidence, what got in the way, and one thing to carry into the next cycle.",
        "",
        "Record no score. The review records scores together, in the room.",
      ].join("\n"),
  },
  {
    name: "what-do-i-owe",
    description: "List what is waiting on me: check-ins, blockers and reviews.",
    arguments: [],
    render: () =>
      [
        "List what is waiting on me, the latest first.",
        "",
        "1. Call review.inbox for the check-ins waiting on my review and my other obligations.",
        "2. Call goals.list with mine set to true. A goal whose next check-in is today or past is a check-in I owe.",
        "3. Call blockers.board for the blockers I own.",
        "4. Call notifications.list for what I have not read.",
        "",
        "Give me one list. Each line says what it is, how late it is and where to open it. Change nothing.",
      ].join("\n"),
  },
];

/**
 * The two tools that are not registry actions (P5-T09c).
 *
 * Converted here rather than declared here: `research.ts` owns what they are and
 * this owns how a tool is built, so a research tool and a registry tool cannot
 * come to carry different fields. Their safety class is fixed rather than read
 * from a route, because neither has a route: both are reads and both say so.
 */
function researchToolFor(spec: ResearchToolSpec): McpTool {
  const schema = jsonSchema(spec.input);
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: schema,
    scope: spec.scope,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    example: exampleFor(schema),
  };
}

export const RESEARCH_TOOLS: readonly McpTool[] =
  RESEARCH_TOOL_SPECS.map(researchToolFor);

/**
 * Every tool: the registry in its own order, then the two research tools.
 *
 * Appended rather than interleaved so that adding them moved no existing entry
 * in `contract/mcp.json`, and the drift gate's first report of this change named
 * exactly two additions.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  // An action marked off the agent surface is not a tool at all, so neither
  // the catalogue nor the dispatcher can name it (mcp-toolsets.md §2.2).
  ...REST_ROUTES.filter((route) => route.agentSurface).map(toolFor),
  ...RESEARCH_TOOLS,
];

export function buildCatalogue(): McpCatalogue {
  return {
    version: CATALOGUE_VERSION,
    tools: [...MCP_TOOLS],
    resources: [...MCP_RESOURCES],
    prompts: [...MCP_PROMPTS],
  };
}

/** The tool one name means, or null. */
export function toolNamed(name: string): McpTool | null {
  return MCP_TOOLS.find((tool) => tool.name === name) ?? null;
}

export interface CatalogueDifference {
  readonly kind: "added" | "removed" | "changed";
  readonly tool: string;
  readonly detail: string;
}

/**
 * What moved between a committed catalogue and a fresh one.
 *
 * Per tool rather than a byte comparison, for the same reason the OpenAPI diff
 * is: a failing gate that says "the file differs" sends somebody hunting, and a
 * failing gate that names the tool and what changed about it does not.
 */
export function diffCatalogue(
  committed: McpCatalogue,
  fresh: McpCatalogue,
): readonly CatalogueDifference[] {
  const differences: CatalogueDifference[] = [];
  const before = new Map((committed.tools ?? []).map((t) => [t.name, t]));
  const after = new Map(fresh.tools.map((t) => [t.name, t]));

  for (const [name, tool] of after) {
    const previous = before.get(name);
    if (!previous) {
      differences.push({
        kind: "added",
        tool: name,
        detail: "in the registry and not in the committed catalogue",
      });
      continue;
    }
    // The two that matter most are named on their own, because "changed" for a
    // safety class is a security change and "changed" for a summary is not.
    if (previous.scope !== tool.scope) {
      differences.push({
        kind: "changed",
        tool: name,
        detail: `its scope moved from ${previous.scope} to ${tool.scope}`,
      });
      continue;
    }
    if (
      JSON.stringify(previous.annotations) !== JSON.stringify(tool.annotations)
    ) {
      differences.push({
        kind: "changed",
        tool: name,
        detail: "its safety hints moved",
      });
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(tool)) {
      differences.push({
        kind: "changed",
        tool: name,
        detail: "its schema, summary or example has moved",
      });
    }
  }

  for (const [name] of before) {
    if (!after.has(name)) {
      differences.push({
        kind: "removed",
        tool: name,
        detail: "in the committed catalogue and no longer in the registry",
      });
    }
  }

  return differences;
}
