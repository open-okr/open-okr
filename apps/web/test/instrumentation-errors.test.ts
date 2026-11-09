/**
 * Next's server error hook, to the log line and the counter
 * (docs/design/error-reporting.md §5 E1, §6).
 */
import {
  flushErrorReports,
  installErrorReporting,
  METRIC,
  type MetricRecorder,
  NO_METRICS,
  OperationError,
  setDefaultMetrics,
} from "@openokr/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { onRequestError } from "../instrumentation";
import { routePattern } from "../lib/error-reporting";

const request = {
  path: "/goals/6f1c2a9e?draft=Win%20Acme%20back",
  method: "POST",
  headers: { cookie: "better-auth.session_token=secret-cookie-value" },
};

const actionContext = {
  routerKind: "App Router",
  routePath: "/(app)/goals/[id]/page",
  routeType: "action",
  renderSource: "react-server-components",
  revalidateReason: undefined,
  renderType: "dynamic",
};

let lines: Record<string, unknown>[];
let counted: { name: string; labels?: Readonly<Record<string, string>> }[];

const metrics: MetricRecorder = {
  count(name, labels) {
    counted.push({ name, ...(labels ? { labels } : {}) });
  },
  observe() {},
  gauge() {},
  span(_name, _attributes, fn) {
    return fn();
  },
};

const original = process.env.NEXT_RUNTIME;

beforeEach(() => {
  lines = [];
  counted = [];
  process.env.NEXT_RUNTIME = "nodejs";
  setDefaultMetrics(metrics);
  installErrorReporting({
    release: "0.7.0",
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  });
});

afterEach(() => {
  process.env.NEXT_RUNTIME = original;
  setDefaultMetrics(NO_METRICS);
  installErrorReporting({ release: "unknown" });
});

describe("onRequestError", () => {
  it("writes one line with the source, class, digest, route and stack, and counts it", async () => {
    const error = Object.assign(
      new TypeError("Cannot read properties of undefined (reading 'title')"),
      { digest: "3141592653" },
    );
    await onRequestError(error, request, actionContext);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "error.report",
      source: "action",
      class: "TypeError",
      digest: "3141592653",
      route: "/goals/[id]",
      method: "POST",
      version: "0.7.0",
    });
    expect(String(lines[0]?.stack)).toContain("TypeError: Cannot read");
    expect(
      counted.filter((entry) => entry.name === METRIC.errorsTotal),
    ).toEqual([{ name: METRIC.errorsTotal, labels: { source: "action" } }]);
  });

  it("never carries the path, the query string or a header", async () => {
    await onRequestError(new TypeError("x"), request, {
      ...actionContext,
      routeType: "render",
    });
    const line = JSON.stringify(lines);
    expect(lines[0]).toMatchObject({ source: "request" });
    expect(line).not.toContain("6f1c2a9e");
    expect(line).not.toContain("Acme");
    expect(line).not.toContain("secret-cookie-value");
  });

  it("writes nothing for a refusal or for Next's own control flow", async () => {
    await onRequestError(
      new OperationError("forbidden", "No."),
      request,
      actionContext,
    );
    await onRequestError(
      Object.assign(new Error("NEXT_REDIRECT"), {
        digest: "NEXT_REDIRECT;replace;/home;307;",
      }),
      request,
      actionContext,
    );
    expect(lines).toEqual([]);
    expect(
      counted.filter((entry) => entry.name === METRIC.errorsTotal),
    ).toEqual([]);
  });

  it("does nothing outside the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await onRequestError(new TypeError("x"), request, actionContext);
    await flushErrorReports(10);
    expect(lines).toEqual([]);
  });
});

describe("routePattern", () => {
  it("keeps the pattern and drops the file name and route groups", () => {
    expect(routePattern("/(app)/goals/[id]/page")).toBe("/goals/[id]");
    expect(routePattern("/api/v1/[[...path]]/route")).toBe(
      "/api/v1/[[...path]]",
    );
    expect(routePattern("/page")).toBe("/");
    expect(routePattern(undefined)).toBeNull();
  });
});
