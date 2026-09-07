import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { ACTIONS } from "../src/actions/registry.ts";
import { errorFor, statusFor } from "../src/api/errors.ts";
import {
  decodeCursor,
  decodeParam,
  encodeCursor,
  inputFrom,
  nextCursorFor,
  REST_ROUTES,
  routeAt,
} from "../src/api/surface.ts";
import { OperationError } from "../src/operations/errors.ts";

/**
 * The REST surface as a projection (P5-T07a).
 *
 * Pure: no database. What is being tested is that the surface is generated from
 * the registry and refuses precisely, which is the whole claim of a generated
 * projection.
 */

const routeOf = (action: string) => {
  const found = REST_ROUTES.find((route) => route.action === action);
  if (!found) {
    throw new Error(`no route for ${action}`);
  }
  return found;
};

describe("the projection", () => {
  it("covers every registry action exactly once", () => {
    expect(REST_ROUTES).toHaveLength(ACTIONS.length);
    expect(new Set(REST_ROUTES.map((route) => route.path)).size).toBe(
      ACTIONS.length,
    );
  });

  it("gives a read a GET and a write a POST, so a proxy retry cannot write", () => {
    expect(routeOf("goals.list").method).toBe("GET");
    expect(routeOf("goals.create").method).toBe("POST");
    expect(routeOf("tokens.revoke").method).toBe("POST");
  });

  it("derives the path from the action name", () => {
    expect(routeOf("sessions.createBlocker").path).toBe(
      "/sessions/createBlocker",
    );
    expect(routeAt(["sessions", "createBlocker"])?.action).toBe(
      "sessions.createBlocker",
    );
    expect(routeAt(["sessions", "nothingLikeThis"])).toBeNull();
  });

  it("takes the scope from the safety class, so there is one word not two", () => {
    expect(routeOf("goals.list").scope).toBe("read");
    expect(routeOf("goals.create").scope).toBe("write");
    // Revoking a token cannot be undone, so it needs the third scope.
    expect(routeOf("tokens.revoke").scope).toBe("destructive");
  });

  it("lists the parameters an action declares, from its own schema", () => {
    const parameters = routeOf("goals.list").parameters;
    expect(parameters).toContain("spaceId");
    expect(parameters).toContain("health");
    expect(parameters).not.toContain("workspaceId");
  });
});

describe("reading parameters", () => {
  it("refuses a parameter the action does not declare, and names it", () => {
    const result = inputFrom(routeOf("goals.list"), [["spaceID", "x"]]);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error.code).toBe("unsupported_parameter");
      // Naming the field is the point: silently dropping it is how somebody
      // spends an afternoon deciding the filter is broken.
      expect(result.error.message).toContain("spaceID");
      expect(result.error.message).toContain("spaceId");
    }
  });

  it("passes a declared parameter through", () => {
    const result = inputFrom(routeOf("goals.list"), [
      ["level", "team"],
      ["includeClosed", "true"],
    ]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.input).toEqual({ level: "team", includeClosed: true });
    }
  });

  it("reads only values that look like JSON, so a title of digits stays text", () => {
    expect(decodeParam("true")).toBe(true);
    expect(decodeParam("12")).toBe(12);
    expect(decodeParam('["a","b"]')).toEqual(["a", "b"]);
    expect(decodeParam("team")).toBe("team");
    expect(decodeParam("2026 plan")).toBe("2026 plan");
    // A UUID starts with a digit often enough that this matters.
    expect(decodeParam("7f3c1d2e-0000-4000-8000-000000000000")).toBe(
      "7f3c1d2e-0000-4000-8000-000000000000",
    );
  });
});

describe("paging", () => {
  it("refuses a cursor on an action that does not page, naming the action", () => {
    const result = inputFrom(routeOf("goals.list"), [["cursor", "abc"]]);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error.code).toBe("unsupported_parameter");
      expect(result.error.message).toContain("goals.list");
    }
  });

  it("accepts a cursor on an action that does", () => {
    const cursor = encodeCursor({ at: "2026-08-27T09:00:00.000Z", id: "x" });
    const result = inputFrom(routeOf("activities.workspaceFeed"), [
      ["cursor", cursor],
    ]);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.input.cursor).toEqual({
        at: "2026-08-27T09:00:00.000Z",
        id: "x",
      });
    }
  });

  it("refuses a cursor this surface did not issue", () => {
    const result = inputFrom(routeOf("activities.workspaceFeed"), [
      ["cursor", "not-base64-json"],
    ]);
    expect(result.kind).toBe("error");
  });

  it("builds the next cursor from the last item's declared fields", () => {
    const route = routeOf("activities.workspaceFeed");
    const next = nextCursorFor(route, [
      { at: "2026-08-26T09:00:00.000Z", id: "a" },
      { at: "2026-08-25T09:00:00.000Z", id: "b" },
    ]);
    expect(next).not.toBeNull();
    expect(decodeCursor(next as string)).toEqual({
      at: "2026-08-25T09:00:00.000Z",
      id: "b",
    });
  });

  it("has no next cursor at the end, and none at all for an unpaged action", () => {
    expect(nextCursorFor(routeOf("activities.workspaceFeed"), [])).toBeNull();
    expect(nextCursorFor(routeOf("goals.list"), { goals: [] })).toBeNull();
  });
});

describe("the error enumeration", () => {
  it("turns a schema refusal into field messages a form can use", () => {
    const schema = z.object({ name: z.string().min(3) });
    let error: unknown;
    try {
      schema.parse({ name: "x" });
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ZodError);
    const mapped = errorFor(error);
    expect(mapped.code).toBe("invalid_input");
    expect(mapped.fields?.name).toBeTruthy();
    expect(statusFor(mapped.code)).toBe(422);
  });

  it("keeps not-found as not-found, because core has already collapsed it", () => {
    const mapped = errorFor(new OperationError("not_found", "No such goal."));
    expect(mapped.code).toBe("not_found");
    expect(statusFor(mapped.code)).toBe(404);
  });

  it("describes nothing about an error it does not recognise", () => {
    const mapped = errorFor(
      new Error('duplicate key value violates unique constraint "goals_pkey"'),
    );
    expect(mapped.code).toBe("internal");
    expect(mapped.message).not.toContain("goals_pkey");
    expect(statusFor(mapped.code)).toBe(500);
  });
});
