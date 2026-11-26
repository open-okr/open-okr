import { callAction } from "@openokr/core";
import { NextResponse } from "next/server";
import {
  FLOWYTEAM_STATE_COOKIE,
  importsPath,
  instanceOrigin,
  outcomeOf,
  stateCookieOptions,
} from "../../../../../lib/flowyteam";
import { getPool } from "../../../../../lib/pool";
import { refuseCrossSite } from "../../../../../lib/same-origin";
import { getKeyRing } from "../../../../../lib/secrets";
import { requireWorkspace } from "../../../../../lib/workspace";

/**
 * Starts connecting FlowyTeam (docs/design/flowyteam-connect.md §3).
 *
 * A POST from the Import screen, so another site cannot start a connection in
 * somebody's name. `imports.flowyteamConnect` decides who may and builds the
 * address; this route only keeps its sealed state in a cookie and sends the
 * administrator to FlowyTeam.
 *
 * **Two answers, one flow.** A plain form post gets a 303 to FlowyTeam. The
 * Import card asks with `Accept: application/json` and gets `{ url }` with the
 * same cookie instead, then moves the page itself: `/admin/imports` is served
 * with `form-action 'self'`, which forbids a form post from being redirected
 * to another origin, and widening that for every admin page would be a worse
 * trade than one fetch (C5 live trial).
 */
export const dynamic = "force-dynamic";

/** The card's fetch, as opposed to a plain form post. */
function wantsJson(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

/** Where to go next: a 303 for a form, `{ url }` for the card. */
function sendTo(request: Request, url: string): NextResponse {
  return wantsJson(request)
    ? NextResponse.json({ url }, { headers: { "cache-control": "no-store" } })
    : NextResponse.redirect(url, 303);
}

export async function POST(request: Request): Promise<Response> {
  const crossSite = refuseCrossSite(request);
  if (crossSite) {
    return crossSite;
  }
  const { session, workspace } = await requireWorkspace();
  const origin = instanceOrigin();
  try {
    const started = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
        ring: getKeyRing(),
        baseUrl: origin,
      },
      "imports.flowyteamConnect",
      {},
    );
    const response = sendTo(request, started.authorizeUrl);
    response.cookies.set(
      FLOWYTEAM_STATE_COOKIE,
      started.stateCookie,
      stateCookieOptions(),
    );
    return response;
  } catch (error) {
    return sendTo(
      request,
      new URL(importsPath(outcomeOf(error)), origin).toString(),
    );
  }
}
