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
 */
export const dynamic = "force-dynamic";

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
    const response = NextResponse.redirect(started.authorizeUrl, 303);
    response.cookies.set(
      FLOWYTEAM_STATE_COOKIE,
      started.stateCookie,
      stateCookieOptions(),
    );
    return response;
  } catch (error) {
    return NextResponse.redirect(
      new URL(importsPath(outcomeOf(error)), origin),
      303,
    );
  }
}
