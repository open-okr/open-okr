import { callAction } from "@openokr/core";
import { type NextRequest, NextResponse } from "next/server";
import {
  FLOWYTEAM_STATE_COOKIE,
  getFlowyteamGateway,
  importsPath,
  instanceOrigin,
  outcomeOf,
  stateCookieOptions,
} from "../../../../../lib/flowyteam";
import { getPool } from "../../../../../lib/pool";
import { getKeyRing } from "../../../../../lib/secrets";
import { requireWorkspace } from "../../../../../lib/workspace";

/**
 * Where FlowyTeam sends the administrator back (docs/design/flowyteam-connect.md
 * §3, §4.1).
 *
 * The session and the sealed state cookie are what authorise it, and
 * `imports.flowyteamFinishConnect` checks both before it spends the code. The
 * cookie is cleared on every outcome: a state is good for one attempt.
 * Whatever happens, the administrator lands on Import with one word saying
 * how it went, never a token and never FlowyTeam's own text.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const { session, workspace } = await requireWorkspace();
  const origin = instanceOrigin();
  const params = request.nextUrl.searchParams;
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";
  const cookie = request.cookies.get(FLOWYTEAM_STATE_COOKIE)?.value ?? "";

  let outcome = "connected";
  if (params.get("error")) {
    // The admin declined, or FlowyTeam refused before asking them.
    outcome = params.get("error") === "access_denied" ? "denied" : "refused";
  } else if (!code || !state) {
    outcome = "state_invalid";
  } else {
    try {
      await callAction(
        {
          pool: getPool(),
          workspaceId: workspace.workspaceId,
          actor: { kind: "human", userId: session.user.id },
          ring: getKeyRing(),
          baseUrl: origin,
          flowyteam: await getFlowyteamGateway(),
        },
        "imports.flowyteamFinishConnect",
        { code, state, stateCookie: cookie || "-" },
      );
    } catch (error) {
      outcome = outcomeOf(error);
    }
  }

  const response = NextResponse.redirect(
    new URL(importsPath(outcome), origin),
    303,
  );
  response.cookies.set(FLOWYTEAM_STATE_COOKIE, "", {
    ...stateCookieOptions(),
    maxAge: 0,
  });
  return response;
}
