/**
 * The liveness check the container and the chart probe.
 *
 * Answers 200 while the database answers, because a probe that failed on a
 * degraded scheduler would restart a serving instance for something a restart
 * does not fix.
 *
 * **The body says nothing else.** It used to say whether the scheduler started
 * and whether the database role bypasses row-level security. This route is
 * public, and a caller who can read that a tenant floor is off knows which
 * instances are worth attacking. Both findings are still there for whoever is
 * entitled to them: `/admin/general` shows them to an administrator, the boot
 * log carries them, and `/api/status` reports the scheduler.
 */
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await getPool().query("select 1");
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
  return NextResponse.json({ status: "ok" });
}
