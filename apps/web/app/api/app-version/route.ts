import { loadEnv } from "@openokr/config";
import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";

/**
 * The live build id the stale-deployment reload polls (P2-T10 item 9).
 *
 * Authenticated rather than public, unlike a typical "/version" endpoint:
 * `/api/health` (P1-T09) deliberately says nothing to an unauthenticated
 * caller, on the reasoning that a version string is reconnaissance for
 * anyone who can reach the port. This endpoint carries the same value, so
 * it sits behind a session instead of relaxing that stance.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ buildId: loadEnv().APP_BUILD_ID });
}
