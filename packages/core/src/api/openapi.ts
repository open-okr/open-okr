/**
 * The OpenAPI document, generated from the registry (§14, P5-T07b).
 *
 * **Generated at import time, from the same routes the transport serves.** The
 * document cannot describe an action the surface does not have, or miss one it
 * does, because both read `REST_ROUTES`. A hand-written document, or one
 * generated from a separate list, is a description that drifts, and §14 asks for
 * it to be "generated from the schemas" precisely so it cannot.
 *
 * **The schemas are the actions' own Zod schemas, converted.** `z.toJSONSchema`
 * emits JSON Schema 2020-12, which is the dialect OpenAPI 3.1 uses, so there is
 * no second description of any shape anywhere. A field's constraints reach the
 * document because the action declares them, not because somebody wrote them
 * down twice.
 *
 * **Read parameters are per field, not one blob.** A GET is described with one
 * query parameter per input field, each with its own schema, so a generated
 * client produces named arguments and a reader can see what a list takes. That
 * is also where §14's "filter grammar matching the list contracts" becomes
 * visible: the filters *are* the parameters.
 *
 * **Two OpenAPI extensions, both of them facts the registry already holds.**
 * `x-openokr-scope` is the token scope a call needs and `x-openokr-safety` is
 * the action's safety class. The MCP tool catalogue (P5-T09) needs the safety
 * class for its own hints, and a client generator can use the scope to fail
 * early rather than at the server.
 */
import { type ZodType, z } from "zod";
import { API_ERROR_CODES, statusFor } from "./errors.ts";
import {
  API_BASE,
  API_VERSION,
  REST_ROUTES,
  type RestRoute,
} from "./surface.ts";

/** A JSON object, as the document is built and compared. */
export type JsonObject = Record<string, unknown>;

/**
 * The version in the document's `info` block.
 *
 * The surface version, not the product's: §14 says the versioned surface is
 * stable and a breaking change gets a new version side by side, so a document
 * whose version moved with every release would say the opposite of that.
 */
const DOCUMENT_VERSION = "1.0.0";

/**
 * One Zod schema as JSON Schema, cleaned for embedding.
 *
 * `$schema` is stripped: it is correct at the root of a standalone schema and
 * wrong inside an OpenAPI document, which declares its own dialect once.
 *
 * `unrepresentable: "any"` rather than throwing. A refusal here would make one
 * unrepresentable field fail the whole document, and the document is the only
 * place a caller can learn about the other three hundred. It is not a licence
 * to keep such fields: `comments.list` declared two `z.date()` outputs that no
 * JSON response could ever have carried, and this generator is what found them
 * (they are ISO strings now). Nothing in the registry needs this today.
 */
function jsonSchema(schema: ZodType, io: "input" | "output"): JsonObject {
  const converted = z.toJSONSchema(schema, {
    io,
    unrepresentable: "any",
    target: "draft-2020-12",
  }) as JsonObject;
  const { $schema, ...rest } = converted;
  return rest;
}

/** The properties of an object schema, for a read's query parameters. */
function propertiesOf(
  schema: JsonObject,
): { name: string; schema: JsonObject; required: boolean }[] {
  const properties = schema.properties as
    | Record<string, JsonObject>
    | undefined;
  if (!properties) {
    return [];
  }
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(properties).map(([name, value]) => ({
    name,
    schema: value,
    required: required.has(name),
  }));
}

/**
 * The distinct statuses the error enumeration produces, in order.
 *
 * Several codes share a status (`insufficient_scope` and `forbidden` are both
 * 403), so this collapses them and the shared response body names the codes.
 */
function errorStatuses(): { status: number; codes: string[] }[] {
  const byStatus = new Map<number, string[]>();
  for (const code of API_ERROR_CODES) {
    const status = statusFor(code);
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return [...byStatus.entries()]
    .map(([status, codes]) => ({ status, codes }))
    .sort((a, b) => a.status - b.status);
}

/**
 * Declared once in `components.responses` and referenced by every operation.
 *
 * Written out per operation instead, the same nine blocks would appear 265
 * times and add most of a megabyte to a file whose whole job is to make a
 * change to the contract visible in a diff. A reader of that diff should see
 * the action that moved, not the boilerplate around it.
 */
function errorResponseRefs(): JsonObject {
  const responses: JsonObject = {};
  for (const { status } of errorStatuses()) {
    responses[String(status)] = {
      $ref: `#/components/responses/E${status}`,
    };
  }
  return responses;
}

function errorResponseComponents(): JsonObject {
  const components: JsonObject = {};
  for (const { status, codes } of errorStatuses()) {
    components[`E${status}`] = {
      description: `\`error.code\` is ${codes.map((code) => `\`${code}\``).join(" or ")}.`,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/Error" },
        },
      },
    };
  }
  return components;
}

function successResponse(route: RestRoute): JsonObject {
  const data = jsonSchema(route.outputSchema, "output");
  const properties: JsonObject = { data };
  const required = ["data"];
  if (route.page) {
    properties.nextCursor = {
      type: ["string", "null"],
      description:
        "Opaque. Pass it back as `?cursor=` for the next page; null or absent at the end.",
    };
  }
  return {
    description: "The action's own output, under `data`.",
    content: {
      "application/json": {
        schema: { type: "object", properties, required },
      },
    },
  };
}

function operationFor(route: RestRoute): JsonObject {
  const input = jsonSchema(route.inputSchema, "input");
  const operation: JsonObject = {
    operationId: route.action,
    summary: route.summary,
    tags: [route.action.split(".")[0] ?? "other"],
    "x-openokr-scope": route.scope,
    "x-openokr-safety": route.safety,
    responses: {
      "200": successResponse(route),
      ...errorResponseRefs(),
    },
  };

  if (route.method === "GET") {
    const parameters = propertiesOf(input).map((property) => ({
      name: property.name,
      in: "query",
      required: property.required,
      schema: property.schema,
    }));
    if (route.page) {
      parameters.push({
        name: "cursor",
        in: "query",
        required: false,
        schema: {
          type: "string",
          description: "An opaque cursor from a previous response.",
        },
      });
    }
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }
    return operation;
  }

  operation.requestBody = {
    required: true,
    content: { "application/json": { schema: input } },
  };
  return operation;
}

/**
 * The whole document.
 *
 * Deterministic: the routes are in registry order and every object is built in
 * a fixed key order, so two runs over the same registry produce byte-identical
 * JSON. The drift check depends on that.
 */
export function buildOpenApiDocument(): JsonObject {
  const paths: JsonObject = {};
  for (const route of REST_ROUTES) {
    paths[route.path] = {
      [route.method.toLowerCase()]: operationFor(route),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "OpenOKR",
      version: DOCUMENT_VERSION,
      description: [
        "Every read and write in OpenOKR, projected from one action registry.",
        "",
        `A path is an action's name: \`goals.list\` is \`${API_BASE}/goals/list\`.`,
        "A read is a GET with query parameters; a write is a POST with a JSON",
        "body. Authenticate with a bearer token minted in account settings, and",
        "give it only the scopes it needs: a token carries the authority of the",
        "member who minted it and never more.",
      ].join("\n"),
    },
    servers: [{ url: API_BASE, description: `Version ${API_VERSION}` }],
    security: [{ bearerAuth: [] }],
    components: {
      responses: errorResponseComponents(),
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "A token from /account/api-tokens with the `rest` audience.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", enum: [...API_ERROR_CODES] },
                message: { type: "string" },
                fields: {
                  type: "object",
                  additionalProperties: { type: "string" },
                  description:
                    "Field path to message. Present for `invalid_input` only.",
                },
              },
            },
          },
        },
      },
    },
    paths,
  };
}

/** One difference between the committed document and a fresh one. */
export interface ContractDifference {
  readonly kind: "added" | "removed" | "changed";
  /** The action, so a failure names what moved rather than a JSON path. */
  readonly action: string;
  readonly detail: string;
}

const pathToAction = (path: string): string =>
  path.replace(/^\//, "").split("/").join(".");

/**
 * What changed between a committed document and a fresh one.
 *
 * Compared per action rather than as one blob, because the useful failure names
 * the action somebody edited. A structural difference outside `paths` (the error
 * enumeration, the security scheme) is reported against the document itself,
 * which is rare and worth saying plainly rather than hiding.
 */
export function diffContract(
  committed: JsonObject,
  fresh: JsonObject,
): readonly ContractDifference[] {
  const differences: ContractDifference[] = [];

  const oldPaths = (committed.paths ?? {}) as JsonObject;
  const newPaths = (fresh.paths ?? {}) as JsonObject;

  for (const path of Object.keys(newPaths)) {
    if (!(path in oldPaths)) {
      differences.push({
        kind: "added",
        action: pathToAction(path),
        detail: "in the registry and not in the committed document",
      });
      continue;
    }
    if (JSON.stringify(oldPaths[path]) !== JSON.stringify(newPaths[path])) {
      differences.push({
        kind: "changed",
        action: pathToAction(path),
        detail: "its schema, summary, scope or safety class has moved",
      });
    }
  }
  for (const path of Object.keys(oldPaths)) {
    if (!(path in newPaths)) {
      differences.push({
        kind: "removed",
        action: pathToAction(path),
        detail: "in the committed document and no longer in the registry",
      });
    }
  }

  // Everything that is not a path. Compared as one, because a change here is a
  // change to the whole surface rather than to one action.
  const shell = (document: JsonObject): string => {
    const { paths, ...rest } = document;
    return JSON.stringify(rest);
  };
  if (shell(committed) !== shell(fresh)) {
    differences.push({
      kind: "changed",
      action: "(the document itself)",
      detail:
        "the info block, the servers, the security scheme or the error enumeration has moved",
    });
  }

  return differences;
}

/** The committed artifact's text: pretty, newline-terminated, stable. */
export function serialiseContract(document: JsonObject): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
