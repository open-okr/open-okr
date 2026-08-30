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
  const { $schema, ...rest } = converted;
  return rest;
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
  },
  {
    name: "prepare-my-review",
    description: "Gather what I need for my quarterly review conversation.",
    arguments: [],
  },
  {
    name: "what-do-i-owe",
    description: "List what is waiting on me: check-ins, blockers and reviews.",
    arguments: [],
  },
];

/** Every tool, in registry order, so the artifact has a stable shape. */
export const MCP_TOOLS: readonly McpTool[] = REST_ROUTES.map(toolFor);

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
