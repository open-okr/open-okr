import { OutboxRelay } from "@openokr/adapters";
import { NextResponse } from "next/server";
import { outboxRowsPerMinute } from "../../../lib/admission";
import { getPool } from "../../../lib/pool";
import { schedulerStatus } from "../../../lib/scheduler-status";
import { statusThresholds } from "../../../lib/status-thresholds";

/**
 * Public instance status, for external monitoring (P8-T06c).
 *
 * Design: `docs/design/status-and-capacity.md` SS2.
 *
 * Three components: database, relay and scheduler. Each reports
 * `operational`, `degraded` or `unavailable`. The overall status is the
 * worst of the three.
 *
 * **Unauthenticated on purpose.** An uptime monitor that has to log in is
 * an uptime monitor that goes red the moment a session expires, which
 * reads as a service outage and is not one. The tradeoff is that the
 * endpoint must say the minimum that is still useful: no workspace names,
 * no counts, no queue depth, no version strings.
 *
 * **A probe target, not a page.** The endpoint is JSON for machines. A
 * human-readable status page is a separate product. The instance not
 * answering is itself the down signal an external monitor needs.
 */
export const dynamic = "force-dynamic";

type ComponentStatus = "operational" | "degraded" | "unavailable";

interface StatusResponse {
  status: ComponentStatus;
  components: {
    database: { status: ComponentStatus };
    relay: { status: ComponentStatus };
    scheduler: { status: ComponentStatus };
  };
  checked_at: string;
}

// The thresholds are what boot resolved: a stored setting, then the variable,
// then the default, validated so each "unavailable" exceeds its "degraded"
// (docs/design/status-and-capacity.md §4, plan 0.7.0 P8). Read from memory,
// because this endpoint answers every probe and must not query
// `system_settings` each time.
const relayDegradedSeconds = (): number => statusThresholds().relay.degraded;
const relayUnavailableSeconds = (): number =>
  statusThresholds().relay.unavailable;

function worst(...statuses: ComponentStatus[]): ComponentStatus {
  if (statuses.includes("unavailable")) return "unavailable";
  if (statuses.includes("degraded")) return "degraded";
  return "operational";
}

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    await getPool().query("select 1");
    return "operational";
  } catch {
    return "unavailable";
  }
}

async function checkRelay(): Promise<ComponentStatus> {
  try {
    // With an outbox rate set, a workspace at its rate is not lag
    // (tenant-limits.md §10 R10): the relay is keeping up with all it may.
    const lagSeconds = await OutboxRelay.oldestPendingSeconds(
      getPool(),
      outboxRowsPerMinute(),
    );
    if (lagSeconds <= 0) return "operational";
    if (lagSeconds >= relayUnavailableSeconds()) return "unavailable";
    if (lagSeconds >= relayDegradedSeconds()) return "degraded";
    return "operational";
  } catch {
    // If we cannot query the outbox at all, the relay is unavailable.
    return "unavailable";
  }
}

export async function GET(): Promise<NextResponse<StatusResponse>> {
  // The scheduler is judged by the shared stamp, so every pod answers the
  // same (plan 0.8.0 H12), including a pod whose scheduler runs on the worker
  // (H10d). `lib/scheduler-status.ts` gathers the reading.
  const [database, relay, scheduler] = await Promise.all([
    checkDatabase(),
    checkRelay(),
    schedulerStatus(),
  ]);

  const overall = worst(database, relay, scheduler);
  const body: StatusResponse = {
    status: overall,
    components: {
      database: { status: database },
      relay: { status: relay },
      scheduler: { status: scheduler },
    },
    checked_at: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: overall === "unavailable" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
