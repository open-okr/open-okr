/**
 * The liveness check the container and the chart probe.
 *
 * Answers 200 while the database answers, because a probe that failed on a
 * degraded scheduler would restart a serving instance for something a restart
 * does not fix. It also says two things a green probe used to hide
 * (completeness review H-01, H-02): whether the scheduler actually started,
 * and whether the database enforces the tenant floor for the role this
 * instance connects as. `/admin` shows the same.
 */
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/auth";
import { schedulerState } from "../../../lib/scheduler";
import { tenantFloor } from "../../../lib/tenant-floor";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await getPool().query("select 1");
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
  const floor = await tenantFloor().catch(() => "unknown" as const);
  return NextResponse.json({
    status: "ok",
    scheduler: schedulerState(),
    tenantFloor: floor,
  });
}
