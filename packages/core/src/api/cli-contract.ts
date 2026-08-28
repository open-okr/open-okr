/**
 * The command line's own generated artifact (§14, P5-T07c-a).
 *
 * **The command line reads this and nothing else.** It has no dependency on
 * `packages/core`, on Drizzle or on a database: it is an HTTP client that knows
 * what commands exist because this file was generated for it. That is what makes
 * the drift check meaningful rather than decorative. If the tool imported the
 * registry directly there would be nothing to drift, and also nothing that could
 * ship without dragging a Postgres driver into a terminal tool.
 *
 * **A command is two words, from the action's name.** `goals.list` is
 * `okr goals list`. Flags are the action's own input fields, kebab-cased, with
 * the type and the enum the schema declares, so the tool can refuse
 * `--level marketing` by name and by value before it opens a socket.
 *
 * **Only what a flag parser needs.** No response shapes, no error catalogue, no
 * descriptions of nested objects: an object-valued flag takes JSON or a file and
 * the server's schema is what judges it. Repeating the whole schema here would
 * be a second copy of the OpenAPI document with a second chance to disagree.
 */
import { type ZodType, z } from "zod";
import { API_VERSION, REST_ROUTES, type RestRoute } from "./surface.ts";

/** What a flag can carry, in the terms a command line can check. */
export type FlagType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object";

export interface CliFlag {
  /** As typed: `--space-id`. */
  readonly name: string;
  /** The action's own field name, which is what goes on the wire. */
  readonly field: string;
  readonly type: FlagType;
  readonly required: boolean;
  /** Present when the schema is an enum, so a wrong value is refused by name. */
  readonly enum?: readonly string[];
}

export interface CliCommand {
  /** `goals list`. Two words, so `okr goals list` reads as a sentence. */
  readonly name: string;
  readonly action: string;
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly scope: string;
  readonly summary: string;
  readonly flags: readonly CliFlag[];
  /** True when the action takes a cursor, so `--cursor` is offered. */
  readonly pages: boolean;
}

export interface CliContract {
  readonly version: string;
  readonly commands: readonly CliCommand[];
}

/** `spaceId` becomes `space-id`. */
export function flagName(field: string): string {
  return field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * The flag type for one property of a converted input schema.
 *
 * A union that is not an enum, or anything else this cannot read, is `string`:
 * the tool passes the text through and the server's own schema refuses it. That
 * is the right default, because the alternative is a command line that refuses
 * something the API would have accepted.
 */
function typeOf(schema: Record<string, unknown>): FlagType {
  const declared = schema.type;
  const single = Array.isArray(declared)
    ? declared.find((value) => value !== "null")
    : declared;
  switch (single) {
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "string";
  }
}

function enumOf(schema: Record<string, unknown>): readonly string[] | null {
  const values = schema.enum;
  if (!Array.isArray(values)) {
    return null;
  }
  const strings = values.filter(
    (value): value is string => typeof value === "string",
  );
  return strings.length === values.length && strings.length > 0
    ? strings
    : null;
}

function flagsFor(input: ZodType): CliFlag[] {
  if (!(input instanceof z.ZodObject)) {
    return [];
  }
  const converted = z.toJSONSchema(input, {
    io: "input",
    unrepresentable: "any",
    target: "draft-2020-12",
  }) as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const properties = converted.properties ?? {};
  const required = new Set(converted.required ?? []);

  return Object.entries(properties).map(([field, schema]) => {
    const values = enumOf(schema);
    return {
      name: flagName(field),
      field,
      type: typeOf(schema),
      required: required.has(field),
      ...(values ? { enum: values } : {}),
    };
  });
}

function commandFor(route: RestRoute): CliCommand {
  const [domain = "", verb = ""] = route.action.split(".");
  return {
    name: `${domain} ${verb}`,
    action: route.action,
    method: route.method,
    path: route.path,
    scope: route.scope,
    summary: route.summary,
    flags: flagsFor(route.inputSchema),
    pages: route.page !== null,
  };
}

export function buildCliContract(): CliContract {
  return {
    version: API_VERSION,
    commands: REST_ROUTES.map(commandFor),
  };
}

/** One difference between the committed command list and a fresh one. */
export interface CliDifference {
  readonly kind: "added" | "removed" | "changed";
  readonly command: string;
  readonly detail: string;
}

export function diffCliContract(
  committed: CliContract,
  fresh: CliContract,
): readonly CliDifference[] {
  const differences: CliDifference[] = [];
  const before = new Map(
    (committed.commands ?? []).map((command) => [command.action, command]),
  );
  const after = new Map(
    fresh.commands.map((command) => [command.action, command]),
  );

  for (const [action, command] of after) {
    const previous = before.get(action);
    if (!previous) {
      differences.push({
        kind: "added",
        command: command.name,
        detail: "in the registry and not in the committed command list",
      });
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(command)) {
      differences.push({
        kind: "changed",
        command: command.name,
        detail: "its flags, summary or scope have moved",
      });
    }
  }
  for (const [action, command] of before) {
    if (!after.has(action)) {
      differences.push({
        kind: "removed",
        command: command.name,
        detail: `${action} is in the committed command list and no longer in the registry`,
      });
    }
  }
  if (committed.version !== fresh.version) {
    differences.push({
      kind: "changed",
      command: "(the surface version)",
      detail: `${committed.version} became ${fresh.version}`,
    });
  }
  return differences;
}
