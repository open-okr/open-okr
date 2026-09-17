import { OutboxRelay } from "@openokr/adapters";
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/pool";
import {
  schedulerBootedAt,
  schedulerEnabled,
  schedulerLastRunAt,
} from "../../../lib/scheduler";

/**
 * Public instance status, for external monitoring (P8-T06c).
 *
 * Design: `docs/design/p8-t06c-status-and-capacity.md` SS2.
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

// The thresholds are read from the environment at boot for the same reason
// the metrics toggle is: the status endpoint runs on every probe and must
// not query `system_settings` each time. The validated environment has no
// entry for these yet (they are settings, not build-time config), so they
// fall back to the design's defaults. An operator who sets them as
// environment variables gets them; the instance setting path picks them up
// after the first restart.
function relayDegradedSeconds(): number {
  const raw = process.env.OPENOKR_STATUS_RELAY_DEGRADED_SECONDS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 300;
}

function relayUnavailableSeconds(): number {
  const raw = process.env.OPENOKR_STATUS_RELAY_UNAVAILABLE_SECONDS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1800;
}

function schedulerDegradedSeconds(): number {
  const raw = process.env.OPENOKR_STATUS_SCHEDULER_DEGRADED_SECONDS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 7200;
}

function schedulerUnavailableSeconds(): number {
  const raw = process.env.OPENOKR_STATUS_SCHEDULER_UNAVAILABLE_SECONDS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 14400;
}

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
    const lagSeconds = await OutboxRelay.oldestPendingSeconds(getPool());
    if (lagSeconds <= 0) return "operational";
    if (lagSeconds >= relayUnavailableSeconds()) return "unavailable";
    if (lagSeconds >= relayDegradedSeconds()) return "degraded";
    return "operational";
  } catch {
    // If we cannot query the outbox at all, the relay is unavailable.
    return "unavailable";
  }
}

function checkScheduler(): ComponentStatus {
  // If the scheduler is disabled by configuration, it is not a component
  // that can be unhealthy. Report operational so the overall status does
  // not degrade for a deliberate choice.
  if (!schedulerEnabled()) return "operational";

  const lastRun = schedulerLastRunAt();
  const booted = schedulerBootedAt();
  const now = Date.now();

  if (lastRun !== null) {
    const ageSec = (now - lastRun) / 1000;
    if (ageSec >= schedulerUnavailableSeconds()) return "unavailable";
    if (ageSec >= schedulerDegradedSeconds()) return "degraded";
    return "operational";
  }

  // No run yet. If the process just booted, give it grace: report
  // operational until the degraded threshold has passed since boot.
  if (booted !== null) {
    const sinceBoot = (now - booted) / 1000;
    if (sinceBoot >= schedulerUnavailableSeconds()) return "unavailable";
    if (sinceBoot >= schedulerDegradedSeconds()) return "degraded";
    return "operational";
  }

  // Scheduler never started (should not happen if schedulerEnabled() is
  // true, but handle it).
  return "unavailable";
}

export async function GET(): Promise<NextResponse<StatusResponse>> {
  const [database, relay] = await Promise.all([checkDatabase(), checkRelay()]);
  const scheduler = checkScheduler();

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
