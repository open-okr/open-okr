import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Scraping /api/metrics with the instance's scrape token
 * (docs/design/metrics-scrape-token.md, plan 0.7.0 B3).
 *
 * Prometheus sent a bearer token the route ignored, and the proxy redirected
 * it to the sign-in page before the route ran. A valid token now answers
 * with the series; anything else gets the same not-found as before.
 */

const TOKEN = "a-scrape-token-of-at-least-thirty-two-characters";

// Gauges are read when the endpoint is, as the real meter reads them.
const gauges = new Map<string, () => unknown>();
vi.mock("../lib/telemetry", () => ({
  isMetricsEnabled: () => true,
  getTelemetry: () => ({
    gauge: (name: string, read: () => unknown) => gauges.set(name, read),
    scrape: async () => {
      const lines = ["openokr_up 1"];
      for (const [name, read] of gauges) {
        lines.push(`${name} ${await read()}`);
      }
      return `${lines.join("\n")}\n`;
    },
  }),
}));
// An outbox of three waiting rows, the oldest twelve seconds old.
vi.mock("../lib/pool", () => ({
  getPool: () => ({
    connect: async () => ({
      query: async (text: string) => ({
        rows: [text.includes("count(*)") ? { pending: 3 } : { lag: 12 }],
        rowCount: 1,
      }),
      release: () => undefined,
    }),
  }),
}));
// The session path, which these cases never satisfy: no signed-in browser.
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => {
    throw new Error("no session");
  },
}));
vi.mock("../lib/access", () => ({ resolveAccessLevelFor: async () => 0 }));

const original = process.env.OPENOKR_METRICS_TOKEN;

const { GET } = await import("../app/api/metrics/route");
const { resetEnvCache } = await import("@openokr/config");

const scrape = (authorization?: string) =>
  GET(
    new Request("http://localhost/api/metrics", {
      headers: authorization ? { authorization } : {},
    }),
  );

beforeEach(() => {
  process.env.DATABASE_URL ??=
    "postgres://openokr:secret@localhost:5432/openokr";
  process.env.OPENOKR_METRICS_TOKEN = TOKEN;
  resetEnvCache();
});

afterEach(() => {
  process.env.OPENOKR_METRICS_TOKEN = original;
  resetEnvCache();
});

describe("scraping the metrics with the instance's token", () => {
  it("answers the series to the right bearer token", async () => {
    const response = await scrape(`Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("openokr_up 1");
  });

  it("answers not-found to a wrong token", async () => {
    expect(
      (await scrape("Bearer not-the-token-at-all-but-long-enough")).status,
    ).toBe(404);
  });

  it("answers not-found to no token and no session", async () => {
    expect((await scrape()).status).toBe(404);
  });

  it("answers not-found to any token when none is configured", async () => {
    delete process.env.OPENOKR_METRICS_TOKEN;
    resetEnvCache();
    expect((await scrape(`Bearer ${TOKEN}`)).status).toBe(404);
  });
});

// docs/design/worker-deployment.md §1.3, plan 0.8.0 H10d.
describe("a process with the relay on the worker", () => {
  it("still serves the queue's gauges, so a scrape of the Service shows it", async () => {
    const relay = process.env.OPENOKR_RELAY;
    process.env.OPENOKR_RELAY = "elsewhere";
    resetEnvCache();
    const { startRelay } = await import("../lib/relay");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(startRelay()).toBeNull();
    } finally {
      write.mockRestore();
      process.env.OPENOKR_RELAY = relay;
    }

    const response = await scrape(`Bearer ${TOKEN}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("openokr_outbox_pending 3");
    expect(text).toContain("openokr_outbox_oldest_pending_seconds 12");
  });
});
