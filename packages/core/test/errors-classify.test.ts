/**
 * Error reporting's first half: what is reported, what a report may say, and
 * the local floor every install gets (docs/design/error-reporting.md §5 E1).
 */
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  classifyError,
  describeError,
  fingerprintOf,
  parseStack,
  scrubFile,
} from "../src/errors/classify.ts";
import {
  type ErrorReport,
  flushErrorReports,
  installErrorReporting,
  REPORTS_PER_FINGERPRINT_PER_MINUTE,
  reportError,
} from "../src/errors/report.ts";
import { OperationError } from "../src/operations/errors.ts";
import { KeyRingError } from "../src/secrets/key-ring.ts";
import {
  METRIC,
  type MetricRecorder,
  NO_METRICS,
  setDefaultMetrics,
} from "../src/telemetry/recorder.ts";

const named = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

/** The shape `pg` gives a server error, and Drizzle's wrapper around it. */
function uniqueViolation(): Error {
  const cause = Object.assign(
    new Error(
      'duplicate key value violates unique constraint "users_email_key"',
    ),
    {
      name: "error",
      severity: "ERROR",
      code: "23505",
      detail: "Key (email)=(priya@northwind.example) already exists.",
      constraint: "users_email_key",
    },
  );
  return Object.assign(
    new Error(
      "Failed query: insert into users (email) values ($1)\nparams: priya@northwind.example",
    ),
    {
      query: "insert into users (email) values ($1)",
      params: ["priya@northwind.example"],
      cause,
    },
  );
}

describe("classifyError (D1)", () => {
  it("passes every refusal and keeps every fault", () => {
    for (const refusal of [
      new OperationError("forbidden", "No."),
      new OperationError("not_found", "No such goal."),
      named("ZodError", "bad"),
      named("RichTextValidationError", "doc.content: bad"),
      named("AdmissionError", "over the limit"),
      named("QuotaExceededError", "full"),
      named("OutboundRefusedError", "private address"),
      named("AIEgressRefusedError", "egress off"),
      named("AIUnavailableError", "no provider"),
      named("AbortError", "aborted"),
    ]) {
      expect(classifyError(refusal).expected, refusal.name).toBe(true);
    }
    for (const fault of [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new Error("The created cycle could not be read back."),
      uniqueViolation(),
      "a thrown string",
    ]) {
      expect(classifyError(fault).expected).toBe(false);
    }
  });

  it("passes Next's control flow by its digest, and an abandoned response", () => {
    expect(
      classifyError(
        Object.assign(new Error("x"), {
          digest: "NEXT_REDIRECT;replace;/home;307;",
        }),
      ).expected,
    ).toBe(true);
    expect(
      classifyError(
        Object.assign(new Error("x"), {
          digest: "NEXT_HTTP_ERROR_FALLBACK;404",
        }),
      ).expected,
    ).toBe(true);
    expect(
      classifyError(new Error("The destination stream closed early.")).expected,
    ).toBe(true);
    expect(
      classifyError(Object.assign(new Error("x"), { digest: "2817364" }))
        .expected,
    ).toBe(false);
  });

  it("reports a dead letter whatever its class", () => {
    expect(
      classifyError(new OperationError("not_found", "gone"), "dead_letter")
        .expected,
    ).toBe(false);
  });
});

describe("what a report may say (D4, D5)", () => {
  it("keeps the message of a class that names code, and withholds the rest", () => {
    expect(
      describeError(
        new TypeError("Cannot read properties of undefined (reading 'id')"),
      ).message,
    ).toBe("Cannot read properties of undefined (reading 'id')");
    expect(describeError(new RangeError("Invalid time value")).message).toBe(
      "Invalid time value",
    );
    expect(
      describeError(new Error("Goal 'Win Acme back' could not be saved"))
        .message,
    ).toBe("Error (message withheld)");
    // JSON.parse quotes its input, so SyntaxError is never on the list.
    expect(
      describeError(new SyntaxError('Unexpected token "secret"')).message,
    ).toBe("SyntaxError (message withheld)");
  });

  it("keeps the message of a product class that declares it safe", () => {
    expect(
      describeError(new KeyRingError("The root key is not valid base64."))
        .message,
    ).toBe("The root key is not valid base64.");
  });

  it("sends a Postgres error's SQLSTATE and constraint, never the address in its detail", () => {
    const described = describeError(uniqueViolation());
    expect(described.className).toBe("DrizzleQueryError");
    expect(described.sqlState).toBe("23505");
    expect(described.constraint).toBe("users_email_key");
    expect(described.message).toBe(
      "DrizzleQueryError (SQLSTATE 23505, constraint users_email_key)",
    );
    expect(JSON.stringify(described)).not.toContain("priya");
    expect(JSON.stringify(described)).not.toContain("insert into");
  });

  it("drops the machine from a file path and the host and query from a URL", () => {
    expect(
      scrubFile("/Users/akmal/open-okr/apps/web/.next/server/chunks/ssr/a1.js"),
    ).toBe(".next/server/chunks/ssr/a1.js");
    expect(
      scrubFile(
        "/srv/app/node_modules/.pnpm/pg@8/node_modules/pg/lib/client.js",
      ),
    ).toBe("node_modules/pg/lib/client.js");
    expect(
      scrubFile("file:///home/priya/openokr/packages/core/src/goals/x.ts"),
    ).toBe("packages/core/src/goals/x.ts");
    expect(
      scrubFile(
        "https://okr.example.com/_next/static/chunks/app.js?token=abc#x",
      ),
    ).toBe("_next/static/chunks/app.js");
    expect(scrubFile("/home/priya/somewhere/else.js")).toBe("else.js");
    expect(scrubFile("node:internal/process/task_queues")).toBe(
      "node:internal/process/task_queues",
    );
  });

  it("reads V8 stacks and Firefox stacks, and never keeps the message line", () => {
    const v8 = parseStack(
      [
        "TypeError: name of a goal somebody typed",
        "    at readGoal (/app/packages/core/src/goals/read.ts:10:5)",
        "    at async Promise.all (index 0)",
        "    at /app/apps/web/app/page.tsx:3:1",
        "    at Client.query (/app/node_modules/pg/lib/client.js:5:2)",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
      ].join("\n"),
    );
    expect(v8[0]).toEqual({
      file: "packages/core/src/goals/read.ts",
      function: "readGoal",
      line: 10,
      column: 5,
      inApp: true,
    });
    expect(
      v8.find((frame) => frame.file === "apps/web/app/page.tsx")?.function,
    ).toBe("<anonymous>");
    expect(v8.find((frame) => frame.file.includes("pg"))?.inApp).toBe(false);
    expect(JSON.stringify(v8)).not.toContain("somebody typed");

    const gecko = parseStack(
      "render@https://okr.example.com/_next/static/chunks/p.js:1:200\n",
    );
    expect(gecko[0]).toMatchObject({
      file: "_next/static/chunks/p.js",
      function: "render",
      line: 1,
      column: 200,
    });
  });
});

describe("the fingerprint (D8)", () => {
  const frames = (line: number) =>
    parseStack(
      [
        "Error: x",
        `    at readGoal (/app/packages/core/src/goals/read.ts:${line}:5)`,
        `    at callAction (/app/packages/core/src/actions/registry.ts:${line + 1}:3)`,
      ].join("\n"),
    );

  it("survives a release that moves line numbers", () => {
    expect(fingerprintOf("action", "TypeError", frames(10))).toBe(
      fingerprintOf("action", "TypeError", frames(99)),
    );
  });

  it("separates sources and classes", () => {
    expect(fingerprintOf("action", "TypeError", frames(10))).not.toBe(
      fingerprintOf("job", "TypeError", frames(10)),
    );
    expect(fingerprintOf("action", "TypeError", frames(10))).not.toBe(
      fingerprintOf("action", "RangeError", frames(10)),
    );
  });
});

describe("the local floor (D3, D9)", () => {
  let lines: Record<string, unknown>[];
  let sent: ErrorReport[];
  let counted: { name: string; labels?: Record<string, string> }[];

  const metrics: MetricRecorder = {
    count(name, labels) {
      counted.push({ name, ...(labels ? { labels: { ...labels } } : {}) });
    },
    observe() {},
    gauge() {},
    span(_name, _attributes, fn) {
      return fn();
    },
  };
  const errorsCounted = () =>
    counted.filter((entry) => entry.name === METRIC.errorsTotal);

  beforeEach(() => {
    lines = [];
    sent = [];
    counted = [];
    setDefaultMetrics(metrics);
    installErrorReporting({
      release: "0.7.0",
      environment: "test",
      write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
      sink: {
        report: (report) => sent.push(report),
        flush: async () => {},
      },
    });
  });

  afterEach(() => {
    setDefaultMetrics(NO_METRICS);
    installErrorReporting({ release: "unknown" });
    vi.useRealTimers();
  });

  it("writes one JSON line and counts it, for a fault", () => {
    reportError(
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      {
        source: "action",
        action: "goals.create",
        workspaceId: "6f1c2a9e-0d3b-4c7a-9e51-2b8f0c7d4a10",
        digest: "2817364",
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "error.report",
      source: "action",
      class: "TypeError",
      action: "goals.create",
      digest: "2817364",
      version: "0.7.0",
      workspaceId: "6f1c2a9e-0d3b-4c7a-9e51-2b8f0c7d4a10",
    });
    expect(String(lines[0]?.stack)).toMatch(
      /^TypeError: Cannot read properties/,
    );
    expect(errorsCounted()).toEqual([
      { name: METRIC.errorsTotal, labels: { source: "action" } },
    ]);
    expect(sent).toHaveLength(1);
  });

  it("writes nothing and counts nothing for a refusal", () => {
    reportError(new OperationError("forbidden", "No."), { source: "action" });
    expect(lines).toEqual([]);
    expect(errorsCounted()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("reports one error once, however many capture points it passes", () => {
    const error = new TypeError("x");
    reportError(error, { source: "request" });
    reportError(error, { source: "process" });
    expect(lines).toHaveLength(1);
  });

  it("holds an action's report for the request, which adds its digest", () => {
    const error = new TypeError("x");
    reportError(
      error,
      { source: "action", action: "goals.list", workspaceId: "w1" },
      { hold: true },
    );
    expect(lines).toEqual([]);
    reportError(error, {
      source: "request",
      digest: "991",
      route: "/goals/[id]",
      method: "GET",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      source: "action",
      action: "goals.list",
      workspaceId: "w1",
      digest: "991",
      route: "/goals/[id]",
      method: "GET",
    });
  });

  it("sends a held report on its own when nothing else catches the error", async () => {
    vi.useFakeTimers();
    reportError(new TypeError("x"), { source: "action" }, { hold: true });
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lines).toHaveLength(1);
  });

  it("sends held reports on shutdown", async () => {
    reportError(new TypeError("x"), { source: "action" }, { hold: true });
    await flushErrorReports(100);
    expect(lines).toHaveLength(1);
  });

  it("counts every repeat and sends at most ten a minute of one error", () => {
    const thrower = () => {
      throw new TypeError("Cannot read properties of null (reading 'title')");
    };
    for (let i = 0; i < 100; i++) {
      try {
        thrower();
      } catch (error) {
        reportError(error, { source: "request" });
      }
    }
    expect(errorsCounted()).toHaveLength(100);
    expect(sent.length).toBeLessThanOrEqual(REPORTS_PER_FINGERPRINT_PER_MINUTE);
    expect(lines.filter((line) => line.kind === "error.report")).toHaveLength(
      REPORTS_PER_FINGERPRINT_PER_MINUTE,
    );
  });

  it("says once a minute how many the caps held back", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 12; i++) {
      reportError(new TypeError("same"), { source: "request" });
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(
      lines.find((line) => line.kind === "error.report.held"),
    ).toMatchObject({
      held: 2,
    });
  });

  it("tags a dead letter with its topic and never its payload", () => {
    const error = new Error("smtp said no to priya@northwind.example");
    reportError(error, {
      source: "dead_letter",
      tags: { topic: "mail.invitation" },
      workspaceId: "6f1c2a9e-0d3b-4c7a-9e51-2b8f0c7d4a10",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      source: "dead_letter",
      tags: { topic: "mail.invitation" },
    });
    expect(JSON.stringify(lines[0])).not.toContain("priya");
    expect(JSON.stringify(sent[0])).not.toContain("priya");
  });

  it("drops a tag or an id that does not have the shape of code", () => {
    reportError(new TypeError("x"), {
      source: "job",
      workspaceId: "not an id, priya@northwind.example",
      route: "/goals/1?q=secret",
      tags: { job: "agents.champion.hourly", note: "Priya's goal" },
    });
    expect(lines[0]).toMatchObject({
      workspaceId: null,
      route: null,
      tags: { job: "agents.champion.hourly" },
    });
  });

  it("reports a fault from callAction with the action, and not a refusal", async () => {
    const admissionThat = (failure: Error) => ({
      actionsPerMinute: 60,
      concurrentActions: 0,
      counters: {
        async rateLimit(): Promise<never> {
          throw failure;
        },
        async incr() {
          return 0;
        },
      },
    });
    const context = (failure: Error) => ({
      pool: {} as Pool,
      workspaceId: "6f1c2a9e-0d3b-4c7a-9e51-2b8f0c7d4a10",
      actor: { kind: "human" as const, userId: "u1" },
      admission: admissionThat(failure),
    });

    await expect(
      callAction(
        context(new OperationError("forbidden", "No.")),
        "goals.list",
        {} as never,
      ),
    ).rejects.toThrow("No.");
    await flushErrorReports(10);
    expect(lines).toEqual([]);
    expect(errorsCounted()).toEqual([]);

    await expect(
      callAction(context(new TypeError("boom")), "goals.list", {} as never),
    ).rejects.toThrow("boom");
    await flushErrorReports(10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      source: "action",
      action: "goals.list",
      userId: "u1",
      class: "TypeError",
    });
  });
});
