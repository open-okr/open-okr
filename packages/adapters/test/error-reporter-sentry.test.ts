/**
 * The Sentry-protocol driver (docs/design/error-reporting.md §5 E2, §6).
 *
 * The envelope, the auth header, batching, the queue cap, `429`, the
 * timeout, the last send at shutdown, and that nothing here ever throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createErrorReporter } from "../src/create-error-reporter.ts";
import { OffErrorReporter } from "../src/drivers/errors/off.ts";
import {
  parseSentryDsn,
  SentryErrorReporter,
  sentryEnvelope,
} from "../src/drivers/errors/sentry.ts";
import type { ErrorEvent, ErrorReportDropReason } from "../src/ports/errors.ts";

const DSN = "https://0123456789abcdef0123456789abcdef@tracker.example.com/42";

const EVENT: ErrorEvent = {
  eventId: "8d3f2c1b0a9e4d7c8b6a5f4e3d2c1b0a",
  timestamp: "2026-11-09T10:00:00.000Z",
  source: "request",
  className: "TypeError",
  message: "Cannot read properties of undefined (reading 'title')",
  frames: [
    {
      file: "packages/core/src/goals/read.ts",
      function: "readGoal",
      line: 10,
      column: 5,
      inApp: true,
    },
    {
      file: "node_modules/pg/lib/client.js",
      function: "Client.query",
      line: null,
      column: null,
      inApp: false,
    },
  ],
  fingerprint: "4f1c0a9e2b3d4c5e6f7a8b9c0d1e2f3a",
  digest: "3141592653",
  traceId: "0af7651916cd43dd8448eb211c80319c",
  spanId: "b7ad6b7169203331",
  release: "0.7.0",
  environment: "staging",
  region: "eu",
  route: "/goals/[id]",
  method: "GET",
  action: "goals.read",
  workspaceId: "6f1c2a9e-0d3b-4c7a-9e51-2b8f0c7d4a10",
  memberId: null,
  userId: "u1",
  sqlState: null,
  constraint: null,
  tags: { topic: "mail.invitation" },
};

/**
 * The envelope as recorded for EVENT. A change here is a change to what every
 * operator's tracker receives, so it is pinned line by line.
 */
const RECORDED_ENVELOPE = [
  '{"event_id":"8d3f2c1b0a9e4d7c8b6a5f4e3d2c1b0a","sent_at":"2026-11-09T10:00:01.000Z"}',
  '{"type":"event","content_type":"application/json"}',
  JSON.stringify({
    event_id: "8d3f2c1b0a9e4d7c8b6a5f4e3d2c1b0a",
    timestamp: 1_794_218_400,
    platform: "node",
    level: "error",
    logger: "openokr",
    release: "0.7.0",
    environment: "staging",
    transaction: "/goals/[id]",
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined (reading 'title')",
          mechanism: { type: "generic", handled: true },
          stacktrace: {
            frames: [
              {
                filename: "node_modules/pg/lib/client.js",
                function: "Client.query",
                in_app: false,
              },
              {
                filename: "packages/core/src/goals/read.ts",
                function: "readGoal",
                lineno: 10,
                colno: 5,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    fingerprint: ["4f1c0a9e2b3d4c5e6f7a8b9c0d1e2f3a"],
    tags: {
      source: "request",
      digest: "3141592653",
      action: "goals.read",
      route: "/goals/[id]",
      method: "GET",
      workspace_id: "6f1c2a9e-0d3b-4c7a-9e51-2b8f0c7d4a10",
      user_id: "u1",
      region: "eu",
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      topic: "mail.invitation",
    },
    contexts: {
      trace: {
        trace_id: "0af7651916cd43dd8448eb211c80319c",
        span_id: "b7ad6b7169203331",
      },
    },
  }),
  "",
].join("\n");

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

function tracker(
  answer: () => Promise<Response> | Response = () =>
    new Response(null, { status: 200 }),
) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), init: init ?? {} });
      return answer();
    },
  ) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

function reporter(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof SentryErrorReporter>[0]> = {},
) {
  const dropped: { reason: ErrorReportDropReason; count: number }[] = [];
  const driver = new SentryErrorReporter({
    dsn: DSN,
    client: "openokr/0.7.0",
    fetch: fetchImpl,
    onDropped: (reason, count) => dropped.push({ reason, count }),
    ...extra,
  });
  return { driver, dropped };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the DSN", () => {
  it("names the envelope endpoint and the key", () => {
    expect(parseSentryDsn(DSN)).toEqual({
      publicKey: "0123456789abcdef0123456789abcdef",
      envelopeUrl: "https://tracker.example.com/api/42/envelope/",
    });
    // A tracker under a path, on its own port, as a self-hoster runs one.
    expect(parseSentryDsn("http://key@10.0.0.5:8000/errors/7")).toEqual({
      publicKey: "key",
      envelopeUrl: "http://10.0.0.5:8000/errors/api/7/envelope/",
    });
  });

  it("refuses what is not one, without repeating it", () => {
    expect(parseSentryDsn("not-a-dsn")).toBeNull();
    expect(parseSentryDsn("https://tracker.example.com/42")).toBeNull();
    expect(parseSentryDsn("ftp://key@tracker.example.com/42")).toBeNull();
    expect(
      () =>
        new SentryErrorReporter({
          dsn: "https://nokey.example/1",
          client: "x",
        }),
    ).toThrow("OPENOKR_ERROR_DSN is not a DSN.");
  });
});

describe("the envelope", () => {
  it("matches the recorded fixture", () => {
    expect(sentryEnvelope(EVENT, "2026-11-09T10:00:01.000Z")).toBe(
      RECORDED_ENVELOPE,
    );
  });

  it("is POSTed with X-Sentry-Auth, within five seconds, and nothing else", async () => {
    vi.useFakeTimers();
    // Two seconds before the recorded `sent_at`, which is when the batch goes.
    vi.setSystemTime(new Date("2026-11-09T09:59:59.000Z"));
    const { sent, fetchImpl } = tracker();
    const { driver } = reporter(fetchImpl);

    driver.report(EVENT);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sent).toHaveLength(1);
    const [post] = sent;
    expect(post?.url).toBe("https://tracker.example.com/api/42/envelope/");
    expect(post?.init.method).toBe("POST");
    expect(post?.init.redirect).toBe("manual");
    expect(post?.init.headers).toEqual({
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth":
        "Sentry sentry_version=7, sentry_key=0123456789abcdef0123456789abcdef, sentry_client=openokr/0.7.0",
    });
    expect(post?.init.body).toBe(RECORDED_ENVELOPE);
  });
});

describe("batching and the caps", () => {
  it("sends at twenty without waiting for the interval", async () => {
    const { sent, fetchImpl } = tracker();
    const { driver } = reporter(fetchImpl);
    for (let i = 0; i < 20; i++) {
      driver.report({ ...EVENT, eventId: `${i}`.padStart(32, "0") });
    }
    await driver.flush(1_000);
    expect(sent).toHaveLength(20);
  });

  it("holds at most a hundred and drops the newest past that", () => {
    const { fetchImpl } = tracker();
    const { driver, dropped } = reporter(fetchImpl, {
      // A batch that never fills, so nothing leaves while the queue grows.
      batchSize: 1_000,
    });
    for (let i = 0; i < 105; i++) {
      driver.report(EVENT);
    }
    expect(dropped).toEqual(
      Array.from({ length: 5 }, () => ({ reason: "queue_full", count: 1 })),
    );
  });

  it("stops sending for Retry-After after a 429, and counts each one dropped", async () => {
    vi.useFakeTimers();
    const { sent, fetchImpl } = tracker(
      () =>
        new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
    );
    const { driver, dropped } = reporter(fetchImpl);

    driver.report(EVENT);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(1);
    expect(dropped).toEqual([{ reason: "rate_limited", count: 1 }]);

    await vi.advanceTimersByTimeAsync(30_000);
    driver.report(EVENT);
    driver.report(EVENT);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(1);
    expect(dropped).toHaveLength(3);
    expect(dropped.every((entry) => entry.reason === "rate_limited")).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(30_000);
    driver.report(EVENT);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toHaveLength(2);
  });
});

describe("a tracker that does not answer", () => {
  it("gives up on a send after the timeout and counts the batch as dropped", async () => {
    const { fetchImpl } = tracker(
      () =>
        new Promise<Response>(() => {
          // Never answers.
        }),
    );
    const neverAnswers = vi.fn(
      (url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          void fetchImpl(url, init);
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    ) as unknown as typeof fetch;
    const { driver, dropped } = reporter(neverAnswers, { timeoutMs: 20 });

    driver.report(EVENT);
    driver.report(EVENT);
    await driver.flush(1_000);
    expect(dropped).toEqual([{ reason: "send_failed", count: 2 }]);
  });

  it("never throws, from report or from flush, whatever fetch does", async () => {
    const throwing = (() => {
      throw new TypeError("fetch is broken");
    }) as unknown as typeof fetch;
    const { driver, dropped } = reporter(throwing, {
      onDropped: () => {
        throw new Error("so is the counter");
      },
    });
    expect(() => driver.report(EVENT)).not.toThrow();
    await expect(driver.flush(100)).resolves.toBeUndefined();
    expect(dropped).toEqual([]);
  });

  it("counts a refused event, and keeps sending the rest of the batch", async () => {
    let calls = 0;
    const { fetchImpl } = tracker(() => {
      calls += 1;
      return new Response("bad", { status: calls === 1 ? 400 : 200 });
    });
    const { driver, dropped } = reporter(fetchImpl);
    driver.report(EVENT);
    driver.report(EVENT);
    await driver.flush(1_000);
    expect(calls).toBe(2);
    expect(dropped).toEqual([{ reason: "send_failed", count: 1 }]);
  });
});

describe("shutdown", () => {
  it("sends what is queued when flushed, before the interval", async () => {
    const { sent, fetchImpl } = tracker();
    const { driver } = reporter(fetchImpl);
    driver.report(EVENT);
    await driver.flush(2_000);
    expect(sent).toHaveLength(1);
  });

  it("returns by its limit even when the tracker hangs", async () => {
    const hangs = (() =>
      new Promise<Response>(() => {
        // Never answers, and ignores the abort.
      })) as unknown as typeof fetch;
    const { driver } = reporter(hangs);
    driver.report(EVENT);
    const started = Date.now();
    await driver.flush(50);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("createErrorReporter", () => {
  it("builds the driver that does nothing when there is no DSN", () => {
    expect(createErrorReporter({ release: "0.7.0" })).toBeInstanceOf(
      OffErrorReporter,
    );
    expect(createErrorReporter({ dsn: "  ", release: "0.7.0" })).toBeInstanceOf(
      OffErrorReporter,
    );
    expect(createErrorReporter({ dsn: DSN, release: "0.7.0" })).toBeInstanceOf(
      SentryErrorReporter,
    );
  });
});
