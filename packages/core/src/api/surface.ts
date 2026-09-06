/**
 * The versioned REST surface, projected from the action registry (§14, P5-T07a).
 *
 * **Generated, not written.** Every route here is derived from a registry entry:
 * the path from the action's name, the method from its safety class, the scope
 * from the same, the parameters from its input schema. A hand-written route file
 * for 300 actions would be a second registry that drifts, and §14's whole claim
 * is "one permission decision, everywhere".
 *
 * **The path is the action's name.** `goals.list` is `/api/v1/goals/list`,
 * `sessions.createBlocker` is `/api/v1/sessions/createBlocker`. A resource-shaped
 * surface (`GET /api/v1/goals/{id}`) would need a hand-written mapping from 300
 * actions onto nouns and verbs, and that mapping is exactly the thing that goes
 * stale. This reads as REST, is completely generated, and a client that can read
 * the index can reach everything.
 *
 * **The method carries the meaning.** A read is a GET with query parameters, and
 * a write is a POST with a JSON body. That is not decoration: a GET that writes
 * is retried by proxies and prefetched by browsers, so the safety class deciding
 * the method is a safety property rather than a style.
 *
 * **Filtering is the action's own input, not a second syntax.** §14 asks for "a
 * filter grammar matching the list contracts". The list contracts already
 * express their filters as declared, typed, individually documented input fields
 * (`goals.list` takes `level`, `spaceId`, `health`, `mine`, `includeClosed`), and
 * every one of them is enforced by the action rather than by a transport. A
 * second `?filter=field:op:value` syntax layered on top would have exactly one
 * operator with a consumer, would need its own parser and its own refusals, and
 * would give a caller two ways to ask the same question with two chances to
 * disagree. So the filter grammar here *is* the declared input, projected as
 * query parameters, with an undeclared parameter refused by name rather than
 * ignored. This is a deliberate reading of §14 and it is recorded in
 * `docs/design/p5-t07-api-design.md` §2 as one.
 */

import type { TokenScope } from "@openokr/db";
import { type ZodType, z } from "zod";
import type { AccessLevel } from "../access/levels.ts";
import type {
  ActionDefinition,
  PageContract,
  SafetyClass,
} from "../actions/define.ts";
import { ACTIONS } from "../actions/registry.ts";
import { type ApiError, apiError } from "./errors.ts";

/** The one version prefix. §14: breaking changes get a new one, side by side. */
export const API_VERSION = "v1";
export const API_BASE = `/api/${API_VERSION}`;

export type ApiMethod = "GET" | "POST";

export interface RestRoute {
  readonly action: string;
  readonly summary: string;
  readonly method: ApiMethod;
  /** Without the base, so a client can join it to any host. */
  readonly path: string;
  readonly access: AccessLevel;
  readonly safety: SafetyClass;
  /** Which token scope reaches it. The same word as the safety class. */
  readonly scope: TokenScope;
  /** The input fields this action declares, in schema order. */
  readonly parameters: readonly string[];
  /**
   * The action's own schemas, carried rather than looked up again (P5-T07b).
   *
   * The OpenAPI generator needs them, and a second lookup by name is a second
   * place the projection could miss an action. These are the same objects the
   * action declares, not a copy: nothing here serialises a route record whole,
   * so a Zod object on it costs nothing.
   */
  readonly inputSchema: ZodType;
  readonly outputSchema: ZodType;
  /** Set when the action takes a cursor and this surface can build the next. */
  readonly page: PageContract | null;
}

/** A read is a GET; a write of either kind is a POST. */
function methodFor(safety: SafetyClass): ApiMethod {
  return safety === "read" ? "GET" : "POST";
}

/**
 * The declared input fields, or null when the input is not an object.
 *
 * Null means this surface cannot tell a typo from a field, so it passes the
 * body through and lets the schema refuse it. Every action in the registry
 * today declares an object, so this is a guard rather than a case.
 */
function fieldsOf(schema: ZodType): readonly string[] | null {
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : null;
}

function routeFor(action: ActionDefinition): RestRoute {
  return {
    action: action.name,
    summary: action.summary,
    method: methodFor(action.safety),
    path: `/${action.name.split(".").join("/")}`,
    access: action.access,
    safety: action.safety,
    scope: action.safety,
    parameters: fieldsOf(action.input) ?? [],
    inputSchema: action.input,
    outputSchema: action.output,
    page: action.page ?? null,
  };
}

export const REST_ROUTES: readonly RestRoute[] = ACTIONS.map(routeFor);

const BY_PATH = new Map(REST_ROUTES.map((route) => [route.path, route]));

/** The route for a request path, or null. */
export function routeAt(segments: readonly string[]): RestRoute | null {
  return BY_PATH.get(`/${segments.join("/")}`) ?? null;
}

/**
 * A JSON value from one query-string value.
 *
 * Query parameters are strings and action inputs are not: a level is an enum, a
 * flag is a boolean, a page size is a number. The rule is narrow on purpose. A
 * value is read as JSON only when it *looks* like JSON that is not a string, so
 * `true`, `12` and `["a","b"]` arrive as themselves while `team`, a UUID and a
 * title stay text. Without that bound, a goal titled `2026` would arrive as a
 * number and be refused by its own schema.
 */
export function decodeParam(raw: string): unknown {
  if (!/^(true|false|null|-?\d|\[|\{)/.test(raw)) {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * An opaque cursor.
 *
 * base64url of the fields the action declared, so a client treats it as a token
 * rather than something to construct. Opaque is the contract: the fields inside
 * can change without a version.
 */
export function encodeCursor(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** The query-string keys this surface handles itself. */
const RESERVED = new Set(["cursor"]);

/**
 * Query parameters as one action input, or a refusal naming the parameter.
 *
 * An undeclared parameter is refused rather than dropped. Dropping is how a
 * caller spends an afternoon on `?spaceID=` and concludes the filter does not
 * work.
 */
export function inputFrom(
  route: RestRoute,
  params: Iterable<readonly [string, string]>,
):
  | { readonly kind: "ok"; readonly input: Record<string, unknown> }
  | {
      readonly kind: "error";
      readonly error: ApiError;
    } {
  const declared = new Set(route.parameters);
  const input: Record<string, unknown> = {};

  for (const [key, value] of params) {
    if (RESERVED.has(key)) {
      if (key === "cursor") {
        if (!route.page) {
          return {
            kind: "error",
            error: apiError(
              "unsupported_parameter",
              `${route.action} does not page, so it takes no cursor.`,
            ),
          };
        }
        const decoded = decodeCursor(value);
        if (decoded === undefined) {
          return {
            kind: "error",
            error: apiError(
              "unsupported_parameter",
              "That cursor is not one this surface issued.",
            ),
          };
        }
        input.cursor = decoded;
      }
      continue;
    }
    if (!declared.has(key)) {
      return {
        kind: "error",
        error: apiError(
          "unsupported_parameter",
          declared.size === 0
            ? `${route.action} takes no parameters.`
            : `${route.action} has no parameter "${key}". It takes: ${[...declared].join(", ")}.`,
        ),
      };
    }
    input[key] = decodeParam(value);
  }

  return { kind: "ok", input };
}

/**
 * The cursor for the page after this one, or null at the end.
 *
 * Built from the last item the action returned, using the fields the action
 * declared. A short page is the last page: this surface does not know the limit
 * the action applied, and guessing would either invent a page that does not
 * exist or hide one that does.
 */
export function nextCursorFor(
  route: RestRoute,
  output: unknown,
): string | null {
  const page = route.page;
  if (!page) {
    return null;
  }
  const items = page.itemsAt
    ? (output as Record<string, unknown> | null)?.[page.itemsAt]
    : output;
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const last = items[items.length - 1] as Record<string, unknown>;
  const cursor: Record<string, unknown> = {};
  for (const field of page.cursorFrom) {
    if (last[field] === undefined) {
      // The action changed shape and this declaration did not. Better no
      // cursor than one that pages back to the beginning forever.
      return null;
    }
    cursor[field] = last[field];
  }
  return encodeCursor(cursor);
}
