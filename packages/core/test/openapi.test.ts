import { describe, expect, it } from "vitest";
import { ACTIONS } from "../src/actions/registry.ts";
import {
  buildOpenApiDocument,
  diffContract,
  type JsonObject,
  serialiseContract,
} from "../src/api/openapi.ts";
import { REST_ROUTES } from "../src/api/surface.ts";

/**
 * The generated OpenAPI document and the drift check (P5-T07b).
 *
 * The task's acceptance criterion is the drift check naming the action that
 * moved, and the last block is that criterion, exercised by editing a document
 * rather than by editing the registry: what has to be proved is that the check
 * *finds and names* the change, and a hand-made stale document is the only way
 * to stage one deterministically.
 */

const document = buildOpenApiDocument();
const paths = document.paths as JsonObject;

const operation = (path: string, method: "get" | "post"): JsonObject =>
  (paths[path] as JsonObject)[method] as JsonObject;

describe("the document", () => {
  it("describes every registry action and nothing else", () => {
    expect(Object.keys(paths)).toHaveLength(ACTIONS.length);
    for (const route of REST_ROUTES) {
      expect(paths[route.path]).toBeTruthy();
    }
  });

  it("is OpenAPI 3.1 and says where the surface lives", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([
      { url: "/api/v1", description: "Version v1" },
    ]);
  });

  it("puts a read on GET with its own query parameters", () => {
    const list = operation("/goals/list", "get");
    const parameters = list.parameters as { name: string; in: string }[];
    const names = parameters.map((parameter) => parameter.name);
    // §14's "filter grammar matching the list contracts", visible: the filters
    // are the parameters, each with its own schema.
    expect(names).toContain("spaceId");
    expect(names).toContain("health");
    expect(parameters.every((parameter) => parameter.in === "query")).toBe(
      true,
    );
  });

  it("puts a write on POST with a request body and no query parameters", () => {
    const create = operation("/goals/create", "post");
    expect(create.requestBody).toBeTruthy();
    expect(create.parameters).toBeUndefined();
  });

  it("carries the scope and the safety class the registry declares", () => {
    expect(operation("/goals/list", "get")["x-openokr-scope"]).toBe("read");
    expect(operation("/goals/create", "post")["x-openokr-scope"]).toBe("write");
    expect(operation("/tokens/revoke", "post")["x-openokr-safety"]).toBe(
      "destructive",
    );
  });

  it("describes the cursor only on an action that pages", () => {
    const feed = operation("/activities/workspaceFeed", "get");
    const names = (feed.parameters as { name: string }[]).map(
      (parameter) => parameter.name,
    );
    expect(names).toContain("cursor");

    const list = operation("/goals/list", "get");
    const listNames = (list.parameters as { name: string }[]).map(
      (parameter) => parameter.name,
    );
    expect(listNames).not.toContain("cursor");
  });

  it("declares the error enumeration once and refers to it", () => {
    const components = document.components as JsonObject;
    const responses = components.responses as JsonObject;
    // Repeated per operation, the same nine blocks would appear 265 times.
    expect(responses.E401).toBeTruthy();
    expect(responses.E403).toBeTruthy();
    expect(operation("/goals/list", "get").responses).toMatchObject({
      "401": { $ref: "#/components/responses/E401" },
    });
  });

  it("asks for a bearer token, at the document level", () => {
    expect(document.security).toEqual([{ bearerAuth: [] }]);
    const components = document.components as JsonObject;
    const schemes = components.securitySchemes as JsonObject;
    expect(schemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it("carries no `$schema` keys, which belong to a standalone schema", () => {
    expect(JSON.stringify(document)).not.toContain('"$schema"');
  });

  it("is deterministic, which is what the drift check rests on", () => {
    expect(serialiseContract(buildOpenApiDocument())).toBe(
      serialiseContract(buildOpenApiDocument()),
    );
  });

  it("ends with a newline, so a diff has no phantom last line", () => {
    expect(serialiseContract(document).endsWith("}\n")).toBe(true);
  });
});

describe("the drift check", () => {
  const clone = (): JsonObject =>
    JSON.parse(JSON.stringify(document)) as JsonObject;

  it("finds nothing between a document and itself", () => {
    expect(diffContract(clone(), clone())).toEqual([]);
  });

  /**
   * The acceptance criterion, in the words the task states it.
   */
  it("names the action whose schema moved (acceptance)", () => {
    const committed = clone();
    const stale = (committed.paths as JsonObject)[
      "/goals/create"
    ] as JsonObject;
    // A registry edit, staged: one action's input gained a field.
    const post = stale.post as JsonObject;
    post.requestBody = { required: true, content: {} };

    const differences = diffContract(committed, document);
    expect(differences).toHaveLength(1);
    expect(differences[0]?.action).toBe("goals.create");
    expect(differences[0]?.kind).toBe("changed");
  });

  it("names an action that is new in the registry", () => {
    const committed = clone();
    delete (committed.paths as JsonObject)["/tokens/create"];

    const differences = diffContract(committed, document);
    expect(differences).toEqual([
      {
        kind: "added",
        action: "tokens.create",
        detail: "in the registry and not in the committed document",
      },
    ]);
  });

  it("names an action that has gone", () => {
    const committed = clone();
    (committed.paths as JsonObject)["/goals/somethingRemoved"] = { get: {} };

    const differences = diffContract(committed, document);
    expect(differences).toEqual([
      {
        kind: "removed",
        action: "goals.somethingRemoved",
        detail: "in the committed document and no longer in the registry",
      },
    ]);
  });

  it("says so when the change is to the whole surface rather than one action", () => {
    const committed = clone();
    (committed.info as JsonObject).version = "0.0.1";

    const differences = diffContract(committed, document);
    expect(differences).toHaveLength(1);
    expect(differences[0]?.action).toBe("(the document itself)");
  });

  it("reports every action that moved, not just the first", () => {
    const committed = clone();
    for (const path of ["/goals/create", "/goals/list", "/spaces/create"]) {
      const entry = (committed.paths as JsonObject)[path] as JsonObject;
      const method = entry.get ? "get" : "post";
      (entry[method] as JsonObject).summary = "something else";
    }

    const differences = diffContract(committed, document);
    expect(differences.map((difference) => difference.action).sort()).toEqual([
      "goals.create",
      "goals.list",
      "spaces.create",
    ]);
  });
});
