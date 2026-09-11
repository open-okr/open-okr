import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTelemetry } from "../src/create-telemetry.ts";
import { OffTelemetry } from "../src/drivers/telemetry/off.ts";
import { OtelTelemetry } from "../src/drivers/telemetry/otel.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

describe("createTelemetry", () => {
  it("builds the meter by default, because a local endpoint sends nothing", () => {
    const telemetry = createTelemetry();
    expect(telemetry).toBeInstanceOf(OtelTelemetry);
  });

  it("builds the off driver when metrics are turned off", () => {
    const telemetry = createTelemetry({ enabled: false });
    expect(telemetry).toBeInstanceOf(OffTelemetry);
  });
});

describe("OffTelemetry", () => {
  it("records nothing and says so rather than returning an empty body", async () => {
    const telemetry = new OffTelemetry();
    telemetry.count("openokr_actions_total", { action: "goals.create" });
    telemetry.observe("openokr_action_duration_seconds", 0.5);

    const text = await telemetry.scrape();
    // A comment line, so a scraper pointed here reads zero series instead of
    // failing to parse. Prometheus ignores `#` lines.
    expect(text.startsWith("#")).toBe(true);
    expect(text).not.toContain("openokr_actions_total");
  });

  it("stops twice without complaining", async () => {
    const telemetry = new OffTelemetry();
    await telemetry.stop();
    await expect(telemetry.stop()).resolves.toBeUndefined();
  });
});

describe("OtelTelemetry", () => {
  it("serves what it recorded, with the labels it was given", async () => {
    const telemetry = new OtelTelemetry({ serviceName: "openokr-test" });
    telemetry.count("openokr_actions_total", {
      action: "goals.create",
      outcome: "ok",
    });
    telemetry.count("openokr_actions_total", {
      action: "goals.create",
      outcome: "ok",
    });

    const text = await telemetry.scrape();
    expect(text).toContain("openokr_actions_total");
    expect(text).toContain('action="goals.create"');
    expect(text).toContain('outcome="ok"');
    await telemetry.stop();
  });

  it("keeps one instrument per name, so a hot path does not register twice", async () => {
    const telemetry = new OtelTelemetry();
    for (let i = 0; i < 50; i += 1) {
      telemetry.count("openokr_actions_total", { action: "goals.read" });
    }

    const text = await telemetry.scrape();
    // One series, not fifty. A fresh counter per call would either duplicate
    // the series or reset it, and both would show up here.
    const series = text
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("openokr_actions_total") && !line.startsWith("#"),
      );
    expect(series).toHaveLength(1);
    expect(series[0]).toContain(" 50");
    await telemetry.stop();
  });

  it("records a duration as seconds into a histogram", async () => {
    const telemetry = new OtelTelemetry();
    telemetry.observe("openokr_action_duration_seconds", 0.25, {
      action: "goals.read",
    });

    const text = await telemetry.scrape();
    expect(text).toContain("openokr_action_duration_seconds");
    // The serializer renders the unit as its own metadata line and leaves the
    // name alone, which is why the `_seconds` suffix has to be in the name.
    expect(text).toContain("openokr_action_duration_seconds_sum");
    await telemetry.stop();
  });

  it("opens no listening socket of its own", async () => {
    // The Prometheus exporter binds 9464 and serves /metrics unless told not
    // to. This product serves the exposition from its own route, behind its
    // own session, and an air-gapped install is entitled to no port it did
    // not ask for. Proven by binding the port ourselves: if the driver had
    // taken it, this would throw EADDRINUSE.
    const telemetry = new OtelTelemetry();
    const { createServer } = await import("node:http");
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(9464, "127.0.0.1", resolve);
    });

    expect(server.listening).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await telemetry.stop();
  });

  it("records nothing after it has been stopped", async () => {
    const telemetry = new OtelTelemetry();
    await telemetry.stop();
    telemetry.count("openokr_actions_total", { action: "goals.create" });

    const text = await telemetry.scrape();
    expect(text).not.toContain("openokr_actions_total");
  });
});

/**
 * The guard for the trap this task walked into on 11 September 2026.
 *
 * `@opentelemetry/api` is an optional peer of both `drizzle-orm` and
 * `better-auth`. Adding it to one workspace package made pnpm resolve
 * `drizzle-orm` twice, once for the packages that could see the peer and
 * once for those that could not, and TypeScript then treated the two
 * `PgColumn` types as unrelated. The whole workspace stopped typechecking
 * with two hundred lines of drizzle generic noise that named neither
 * OpenTelemetry nor the real cause.
 *
 * The fix is to keep the peer uniformly visible. This test is what makes
 * that fix survive the next person, because the failure it prevents is
 * unreadable and the cure is one line in a manifest.
 */
describe("the OpenTelemetry peer stays uniform", () => {
  const MUST_DECLARE = [
    "packages/core",
    "packages/db",
    "packages/agents",
    "packages/test-support",
    "packages/adapters",
    "apps/web",
  ];

  it.each(MUST_DECLARE)("%s declares @opentelemetry/api", async (dir) => {
    const manifest = JSON.parse(
      await readFile(join(REPO_ROOT, dir, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };

    expect(
      declared["@opentelemetry/api"],
      `${dir} must declare @opentelemetry/api, even though it never imports it. ` +
        "It is an optional peer of drizzle-orm and better-auth, and a package " +
        "that cannot see it resolves a second copy of both. The symptom is a " +
        "workspace-wide typecheck failure about incompatible PgColumn types " +
        "that mentions neither this package nor OpenTelemetry.",
    ).toBeDefined();
  });
});

describe("the exposition is readable by an operator", () => {
  it("gives every series a HELP line instead of 'description missing'", async () => {
    const telemetry = new OtelTelemetry();
    telemetry.count("openokr_actions_total", { action: "goals.read" });
    telemetry.observe("openokr_action_duration_seconds", 0.05, {
      action: "goals.read",
    });

    const text = await telemetry.scrape();
    expect(text).not.toContain("description missing");
    expect(text).toContain("# HELP openokr_actions_total Actions called");
    await telemetry.stop();
  });

  it("buckets durations in seconds, not the SDK's millisecond defaults", async () => {
    // The defaults run 0, 5, 10, 25 ... 10000. Against a value in seconds
    // every observation lands in the first real bucket and every percentile
    // drawn from the histogram is a straight line. A 250ms observation must
    // fall above the 0.1 edge and at or below the 0.25 one.
    const telemetry = new OtelTelemetry();
    telemetry.observe("openokr_action_duration_seconds", 0.25, {
      action: "goals.read",
    });

    const text = await telemetry.scrape();
    expect(text).toContain('le="0.1"');
    expect(text).toContain('le="0.25"');
    expect(text).not.toContain('le="10000"');

    const below = text
      .split("\n")
      .find((line) => line.includes('le="0.1"') && line.includes("_bucket"));
    const at = text
      .split("\n")
      .find((line) => line.includes('le="0.25"') && line.includes("_bucket"));
    expect(below?.trimEnd().endsWith(" 0")).toBe(true);
    expect(at?.trimEnd().endsWith(" 1")).toBe(true);
    await telemetry.stop();
  });
});

describe("gauges are read at scrape time, not at event time", () => {
  it("reports whatever the reader says on each scrape, not what it said once", async () => {
    // This is the whole argument for the gauge existing. The outbox lag has
    // to keep growing while the relay is stopped, and a counter written
    // during a drain writes nothing at all once draining stops: the series
    // goes flat and the outage reads as a quiet queue.
    const telemetry = new OtelTelemetry();
    let lag = 5;
    telemetry.gauge("openokr_outbox_oldest_pending_seconds", () => lag);

    const first = await telemetry.scrape();
    expect(first).toContain("openokr_outbox_oldest_pending_seconds 5");

    lag = 42;
    const second = await telemetry.scrape();
    expect(second).toContain("openokr_outbox_oldest_pending_seconds 42");
    await telemetry.stop();
  });

  it("awaits an async reader, because the real one is a query", async () => {
    const telemetry = new OtelTelemetry();
    telemetry.gauge("openokr_outbox_pending", async () => {
      await Promise.resolve();
      return 7;
    });

    const text = await telemetry.scrape();
    expect(text).toContain("openokr_outbox_pending 7");
    await telemetry.stop();
  });

  it("replaces the reader when the same name is registered twice", async () => {
    // A relay that restarts re-registers. Adding a second callback to the
    // same instrument would make the series report both values on every
    // scrape, which reads as a flapping gauge rather than as the duplicate
    // registration it is.
    const telemetry = new OtelTelemetry();
    telemetry.gauge("openokr_outbox_pending", () => 1);
    telemetry.gauge("openokr_outbox_pending", () => 2);

    const text = await telemetry.scrape();
    const series = text
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("openokr_outbox_pending") && !line.startsWith("#"),
      );
    expect(series).toHaveLength(1);
    expect(series[0]).toContain(" 2");
    await telemetry.stop();
  });

  it("loses one unreadable gauge rather than the whole exposition", async () => {
    const telemetry = new OtelTelemetry();
    telemetry.gauge("openokr_outbox_pending", () => {
      throw new Error("the database is unreachable");
    });
    telemetry.count("openokr_actions_total", { action: "goals.read" });

    const text = await telemetry.scrape();
    // The gauge is absent, the counter is not. A gap on one chart is the
    // honest signal; an exposition that fails entirely tells an operator
    // nothing about anything.
    expect(text).not.toContain("openokr_outbox_pending{");
    expect(text).toContain("openokr_actions_total");
    await telemetry.stop();
  });

  it("never calls the reader when metrics are off", async () => {
    // A gauge's reader is a database query. An instance that is not
    // measuring itself must not run one, which is why the off driver ignores
    // the reader rather than storing it.
    const off = new OffTelemetry();
    let called = 0;
    off.gauge("openokr_outbox_pending", () => {
      called += 1;
      return 1;
    });

    await off.scrape();
    expect(called).toBe(0);
  });
});

/**
 * The two lists of series names must agree.
 *
 * `packages/core` owns `METRIC` and `packages/adapters/src/relay.ts` spells
 * four of the same names out again, because this package sits below that one
 * and may not import it. Duplication is the right trade there and a silent
 * rename is what it costs, so this reads both files as text and fails when
 * one moves without the other. Reading source rather than importing it is
 * the same trick `core/test/outbox/handlers.test.ts` uses to hold its own
 * topic list, and for the same reason: the dependency would be the bug.
 */
describe("the duplicated series names agree across the package boundary", () => {
  it("every name the relay spells out is one packages/core declares", async () => {
    const relaySource = await readFile(
      join(REPO_ROOT, "packages/adapters/src/relay.ts"),
      "utf8",
    );
    const coreSource = await readFile(
      join(REPO_ROOT, "packages/core/src/telemetry/recorder.ts"),
      "utf8",
    );

    const inRelay = [...relaySource.matchAll(/"(openokr_[a-z0-9_]+)"/g)].map(
      (match) => match[1],
    );
    const inCore = new Set(
      [...coreSource.matchAll(/"(openokr_[a-z0-9_]+)"/g)].map(
        (match) => match[1],
      ),
    );

    // A floor, so a broken regex cannot pass by matching nothing. The relay
    // spells out four names today.
    expect(inRelay.length).toBeGreaterThanOrEqual(4);
    for (const name of inRelay) {
      expect(
        inCore.has(name as string),
        `${name} is recorded by packages/adapters/src/relay.ts and is not in ` +
          "packages/core's METRIC. One of the two was renamed without the " +
          "other, which splits a dashboard in half without failing anything.",
      ).toBe(true);
    }
  });

  it("every name the driver describes is one packages/core declares", async () => {
    // The HELP text is keyed by name too, so a rename there loses the
    // description silently and the exposition goes back to saying
    // "description missing".
    const driverSource = await readFile(
      join(REPO_ROOT, "packages/adapters/src/drivers/telemetry/otel.ts"),
      "utf8",
    );
    const coreSource = await readFile(
      join(REPO_ROOT, "packages/core/src/telemetry/recorder.ts"),
      "utf8",
    );

    const described = [
      ...driverSource.matchAll(/^ {2}(openokr_[a-z0-9_]+):/gm),
    ].map((match) => match[1]);
    const inCore = new Set(
      [...coreSource.matchAll(/"(openokr_[a-z0-9_]+)"/g)].map(
        (match) => match[1],
      ),
    );

    expect(described.length).toBeGreaterThanOrEqual(10);
    for (const name of described) {
      expect(
        inCore.has(name as string),
        `${name} has a description in the driver and is not in packages/core's METRIC.`,
      ).toBe(true);
    }
  });
});
