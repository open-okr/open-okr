/**
 * Answering a consent request (screen S-40, P5-T08c).
 *
 * **A plain form POST to a route handler, not a server action.** Both answers
 * end in a redirect to an address the *client* owns, and that is a cross-origin
 * navigation: a server action would have to hand it to the router and hope,
 * where a 303 from a route handler is what the protocol has always been. It also
 * works with JavaScript off, which for the one screen that stands between a
 * stranger and somebody's data is worth having.
 *
 * **Both answers leave, and that is the protocol.** An approval carries a code;
 * a refusal carries `access_denied`. The client is waiting on that redirect
 * either way, and a page that said "refused" and stopped would leave an agent
 * hanging until it timed out.
 *
 * **The workspace comes from the form, checked against this person's own
 * memberships.** A field naming a workspace is a field somebody could change, so
 * what it selects is one of the memberships the session already proved.
 */
import { approveAuthorisationForMember, redirectWith } from "@openokr/core";
import type { NextRequest } from "next/server";
import { instanceIssuer } from "../../../../lib/issuer";
import { getPool } from "../../../../lib/pool";
import { requireWorkspace } from "../../../../lib/workspace";

export const dynamic = "force-dynamic";

/** A browser redirect after a POST, which is what turns it into a GET. */
const seeOther = (location: string): Response =>
  new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });

/** When there is nowhere safe to send an answer, the person gets the page back. */
const backToScreen = (request: NextRequest, message: string): Response =>
  seeOther(
    new URL(
      `/oauth/authorize?error_message=${encodeURIComponent(message)}`,
      request.nextUrl.origin,
    ).toString(),
  );

export async function POST(request: NextRequest): Promise<Response> {
  const form = await request.formData();
  const value = (key: string) => String(form.get(key) ?? "").trim();

  const redirectUri = value("redirectUri");
  const state = value("state");
  const approve = value("approve") === "yes";

  if (redirectUri === "") {
    return backToScreen(request, "That request names no address to answer at.");
  }

  if (!approve) {
    return seeOther(
      redirectWith(redirectUri, {
        error: "access_denied",
        error_description: "The request was refused.",
        state,
      }),
    );
  }

  const { session, workspace, memberships } = await requireWorkspace();
  const asked = value("workspaceId");
  // One of this person's own, never whatever the field said.
  const chosen =
    memberships.find((membership) => membership.workspaceId === asked) ??
    workspace;

  const outcome = await approveAuthorisationForMember(getPool(), {
    workspaceId: chosen.workspaceId,
    userId: session.user.id,
    clientId: value("clientId"),
    redirectUri,
    challenge: value("codeChallenge"),
    challengeMethod: value("codeChallengeMethod") || "S256",
    scope: value("scope"),
    resource: value("resource"),
    issuer: instanceIssuer(),
    now: new Date(),
  });

  if (outcome.kind === "refused") {
    return backToScreen(request, outcome.description);
  }

  return seeOther(redirectWith(redirectUri, { code: outcome.code, state }));
}
