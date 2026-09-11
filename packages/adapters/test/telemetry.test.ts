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
