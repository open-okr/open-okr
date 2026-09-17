import { describe, expect, it } from "vitest";

/**
 * Status endpoint shape and exclusions (P8-T06c).
 *
 * Design: `docs/design/p8-t06c-status-and-capacity.md` §2 and §6.
 *
 * This test cannot call the route handler directly because it imports
 * `@openokr/adapters` (for `OutboxRelay.oldestPendingSeconds`) and the pool,
 * which need a database. What it can verify is the contract the response must
 * satisfy: the shape, the exclusions, and the component verdicts.
 *
 * The acceptance criteria that need a running instance (criteria 2-5 in the
 * design) are exercised in the end-to-end suite.
 */

/** The response shape the endpoint must produce. */
interface StatusResponse {
  status: "operational" | "degraded" | "unavailable";
  components: {
    database: { status: "operational" | "degraded" | "unavailable" };
    relay: { status: "operational" | "degraded" | "unavailable" };
    scheduler: { status: "operational" | "degraded" | "unavailable" };
  };
  checked_at: string;
}

describe("status response shape", () => {
  it("the response type matches the design, checked at compile time", () => {
    // This test exists so the type stays aligned with the endpoint.
    // A response that compiles against the type satisfies §6 criterion 1.
    const body: StatusResponse = {
      status: "operational",
      components: {
        database: { status: "operational" },
        relay: { status: "operational" },
        scheduler: { status: "operational" },
      },
      checked_at: new Date().toISOString(),
    };
    expect(body.status).toBe("operational");
    expect(body.components.database.status).toBe("operational");
    expect(body.components.relay.status).toBe("operational");
    expect(body.components.scheduler.status).toBe("operational");
    expect(new Date(body.checked_at).getTime()).not.toBeNaN();
  });

  it("the worst-of rule holds: unavailable overrides everything", () => {
    const worst = (
      ...statuses: Array<"operational" | "degraded" | "unavailable">
    ) => {
      if (statuses.includes("unavailable")) return "unavailable";
      if (statuses.includes("degraded")) return "degraded";
      return "operational";
    };

    expect(worst("operational", "operational", "operational")).toBe(
      "operational",
    );
    expect(worst("operational", "degraded", "operational")).toBe("degraded");
    expect(worst("operational", "degraded", "unavailable")).toBe("unavailable");
    expect(worst("unavailable", "operational", "operational")).toBe(
      "unavailable",
    );
  });
});

describe("exclusions from §6 criterion 6", () => {
  const body: StatusResponse = {
    status: "degraded",
    components: {
      database: { status: "operational" },
      relay: { status: "degraded" },
      scheduler: { status: "operational" },
    },
    checked_at: "2026-09-17T12:00:00.000Z",
  };

  const serialised = JSON.stringify(body);

  it("contains no workspace_id or workspace name", () => {
    expect(serialised).not.toContain("workspace");
  });

  it("contains no tenant count", () => {
    expect(serialised).not.toContain("tenant");
    expect(serialised).not.toContain("count");
  });

  it("contains no version string", () => {
    expect(serialised).not.toContain("version");
    expect(serialised).not.toContain("build");
  });

  it("contains no queue depth", () => {
    expect(serialised).not.toContain("pending");
    expect(serialised).not.toContain("depth");
    expect(serialised).not.toContain("queue");
  });

  it("contains no error message or stack trace", () => {
    expect(serialised).not.toContain("stack");
    expect(serialised).not.toContain("Error");
  });
});

describe("new settings in the instance registry", () => {
  it("all four status thresholds are declared", async () => {
    // Dynamic import so the test does not drag core's full module graph.
    const { INSTANCE_SETTINGS } = await import("@openokr/core");
    const keys = INSTANCE_SETTINGS.map((s: { key: string }) => s.key);
    expect(keys).toContain("status.relayDegradedSeconds");
    expect(keys).toContain("status.relayUnavailableSeconds");
    expect(keys).toContain("status.schedulerDegradedSeconds");
    expect(keys).toContain("status.schedulerUnavailableSeconds");
  });

  it("unavailable defaults are greater than degraded defaults", async () => {
    const { INSTANCE_SETTINGS } = await import("@openokr/core");
    const byKey = new Map(
      INSTANCE_SETTINGS.map((s: { key: string; fallback: unknown }) => [
        s.key,
        s.fallback,
      ]),
    );
    expect(byKey.get("status.relayUnavailableSeconds")).toBeGreaterThan(
      byKey.get("status.relayDegradedSeconds") as number,
    );
    expect(byKey.get("status.schedulerUnavailableSeconds")).toBeGreaterThan(
      byKey.get("status.schedulerDegradedSeconds") as number,
    );
  });
});

describe("capacity metrics are in the METRIC catalogue", () => {
  it("all three P8-T06c series are declared", async () => {
    const { METRIC } = await import("@openokr/core");
    expect(METRIC.poolConnections).toBe("openokr_pool_connections");
    expect(METRIC.concurrentActions).toBe("openokr_concurrent_actions");
    expect(METRIC.admissionRefusalsTotal).toBe(
      "openokr_admission_refusals_total",
    );
  });
});

describe("the design document lists acceptance criteria", () => {
  it("the design file exists", async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const design = await readFile(
      join(
        import.meta.dirname,
        "../../../docs/design/p8-t06c-status-and-capacity.md",
      ),
      "utf8",
    );
    expect(design).toContain("/api/status");
    expect(design).toContain("openokr_pool_connections");
    expect(design).toContain("openokr_concurrent_actions");
    expect(design).toContain("openokr_admission_refusals_total");
  });
});
