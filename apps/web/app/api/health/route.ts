import { NextResponse } from "next/server";
import { getPool } from "../../../lib/auth";

/**
 * Readiness, for the container health check and the compose dependency graph
 * (P1-T09).
 *
 * It queries the database rather than only answering. A process that is
 * listening but cannot reach Postgres is not ready, and the difference matters
 * to compose: the proxy should not be put in front of an instance that will
 * answer every request with an error.
 *
 * Deliberately says almost nothing. This endpoint is unauthenticated, so a
 * version string or a database error here would be reconnaissance for anyone
 * who can reach the port.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await getPool().query("select 1");
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
