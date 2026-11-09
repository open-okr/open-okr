import { createHash, timingSafeEqual } from "node:crypto";
import { loadEnv } from "@openokr/config";
import { ACCESS_LEVELS } from "@openokr/core";
import { NextResponse } from "next/server";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getTelemetry, isMetricsEnabled } from "../../../lib/telemetry";
import { requireWorkspace } from "../../../lib/workspace";

/**
 * This instance's own metrics, in Prometheus text exposition format
 * (P7-T06a).
 *
 * **It serves and never sends.** The numbers leave this process only in the
 * response to somebody who asked for them here, over the instance's own
 * origin, holding an administrator session or, from 0.7.0, the instance's
 * scrape token (docs/design/metrics-scrape-token.md). Nothing is pushed, no address is
 * configured, and an air-gapped install reaches this endpoint exactly as a
 * connected one does. Exporting measurements off the host is
 * `observability.otlp.endpoint`, which arrives at P7-T06c and is empty.
 *
 * **Refuses with not-found rather than forbidden**, matching every other
 * access decision in the product (§8.1 layer 2): a member below `full` and a
 * signed-out visitor get the identical answer, so the endpoint is not an
 * oracle for whether this instance is measuring itself.
 *
 * `full` rather than a lower level because operational series are a picture
 * of the whole workspace: which actions are refused and how often, how long
 * the write path takes, how much work is queued. None of it names a person
 * or repeats anything anybody typed, and all of it is still an operator's
 * view rather than a member's.
 */
export const dynamic = "force-dynamic";

/**
 * Whether the request carries the instance's scrape token
 * (docs/design/metrics-scrape-token.md D1 to D3, plan 0.7.0 B3).
 *
 * Both sides are hashed first, so the two buffers are the same length and the
 * comparison never returns early on a length difference. Unset means no token
 * is accepted at all.
 */
function carriesScrapeToken(request: Request): boolean {
  const configured = loadEnv().OPENOKR_METRICS_TOKEN;
  if (!configured) {
    return false;
  }
  const presented = /^Bearer\s+(.+)$/i.exec(
    request.headers.get("authorization") ?? "",
  )?.[1];
  if (!presented) {
    return false;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(configured));
}

/** A signed-in member with `full` access, the endpoint's first door. */
async function hasFullSession(): Promise<boolean> {
  try {
    const { workspace } = await requireWorkspace();
    const level = await resolveAccessLevelFor(
      workspace.workspaceId,
      workspace.memberId,
    );
    return level >= ACCESS_LEVELS.full;
  } catch {
    // `requireWorkspace` redirects a page. A route handler cannot redirect a
    // scraper usefully, so an unresolved session is simply not found.
    return false;
  }
}

export async function GET(request: Request): Promise<NextResponse | Response> {
  if (!isMetricsEnabled()) {
    // The same not-found as a refusal, on purpose. An operator who has turned
    // metrics off and forgotten reads the setting, not this endpoint.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!carriesScrapeToken(request) && !(await hasFullSession())) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await getTelemetry().scrape();
  return new Response(body, {
    status: 200,
    headers: {
      // The version Prometheus and every compatible scraper expect. Without
      // the version parameter some scrapers fall back to a protobuf
      // negotiation that this endpoint does not implement.
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      // Operational data about a live instance has no business in any cache
      // between here and the operator.
      "cache-control": "no-store",
    },
  });
}
