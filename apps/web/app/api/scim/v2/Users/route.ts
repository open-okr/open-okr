import {
  API_RATE_LIMIT,
  API_RATE_WINDOW_SECONDS,
  type DirectoryMember,
  listDirectoryUsers,
  logSyncOperation,
  parseScimFilter,
  provisionDirectoryUser,
  resolveSCIMToken,
  type SCIMUser,
  scimDisplayName,
  scimError,
  scimList,
  scimPrimaryEmail,
  scimUserResource,
} from "@openokr/core";
import { NextResponse } from "next/server";
import { getAuth, getPool } from "../../../../../lib/auth";
import { getCache } from "../../../../../lib/cache";
import { retryAfter } from "../../../../../lib/retry-after";

/**
 * SCIM 2.0 Users collection (P8-T08, rewritten at P8-T08a; RFC 7644 §3.3).
 *
 * POST /api/scim/v2/Users  provision somebody into the token's workspace.
 * GET  /api/scim/v2/Users  list members, or answer one `userName eq` filter.
 *
 * The bearer token resolves to a workspace and nothing else authorises this
 * surface. Every write goes through `packages/core`, which runs it through the
 * Operation pipeline; this file reads the request, calls one function and
 * shapes the reply.
 */
export const dynamic = "force-dynamic";

const SCIM_HEADERS = { "Content-Type": "application/scim+json" };

/**
 * The workspace a directory token provisions into, or the refusal to send.
 *
 * Every SCIM route calls this first, so the rate limit sits here once rather
 * than in each of them (completeness review M-12). Per directory token, with
 * the REST surface's allowance: a first sync is a burst, and a 429 that says
 * how long to wait slows it rather than failing it. What the limit stops is a
 * runaway connector, or a leaked token, holding the database for everybody
 * else.
 */
export async function authenticateScim(
  request: Request,
): Promise<{ workspaceId: string } | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    return NextResponse.json(scimError(401, "Bearer token required"), {
      status: 401,
    });
  }
  const resolved = await resolveSCIMToken(getPool(), header.slice(7));
  if (!resolved) {
    return NextResponse.json(scimError(401, "Invalid or expired token"), {
      status: 401,
    });
  }

  const limited = await getCache().rateLimit(
    `scim:${resolved.tokenId}`,
    API_RATE_LIMIT,
    API_RATE_WINDOW_SECONDS,
  );
  if (!limited.allowed) {
    // RFC 7644 §3.12's error shape, with the status a directory already knows
    // to back off from.
    return NextResponse.json(
      scimError(
        429,
        `More than ${API_RATE_LIMIT} requests a minute on this token. Try again shortly.`,
      ),
      {
        status: 429,
        headers: {
          ...SCIM_HEADERS,
          "Retry-After": retryAfter(limited.resetSeconds),
        },
      },
    );
  }

  return { workspaceId: resolved.workspaceId };
}

/** One member as a SCIM User resource. */
export const asResource = (member: DirectoryMember, externalId?: string) =>
  scimUserResource({
    id: member.memberId,
    externalId: externalId ?? member.userId,
    userName: member.email,
    displayName: member.name,
    active: member.active,
  });

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const filter = parseScimFilter(
    new URL(request.url).searchParams.get("filter"),
  );
  if (filter === "unsupported") {
    // Said rather than ignored. Answering the whole collection to a filter
    // this surface did not understand would read to the identity provider as
    // "nobody matches" or "everybody matches", and both are worse than a
    // refusal it can log.
    return NextResponse.json(
      scimError(400, "Only a userName eq filter is supported"),
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const members = await listDirectoryUsers(getPool(), auth.workspaceId, filter);

  return NextResponse.json(
    scimList(members.map((member) => asResource(member))),
    { headers: SCIM_HEADERS },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  let body: SCIMUser;
  try {
    body = (await request.json()) as SCIMUser;
  } catch {
    return NextResponse.json(scimError(400, "Invalid JSON"), {
      status: 400,
      headers: SCIM_HEADERS,
    });
  }

  const email = scimPrimaryEmail(body);
  const name = scimDisplayName(body);
  if (!email) {
    return NextResponse.json(scimError(400, "No email found in the request"), {
      status: 400,
      headers: SCIM_HEADERS,
    });
  }

  try {
    const { member, created } = await provisionDirectoryUser(
      { pool: getPool(), auth: getAuth() },
      {
        workspaceId: auth.workspaceId,
        email,
        name,
        ...(body.externalId ? { externalId: body.externalId } : {}),
        ...(body.active === false ? { active: false } : {}),
      },
    );

    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "User",
      operation: created ? "CREATE" : "UPDATE",
      externalId: body.externalId ?? email,
      localId: member.memberId,
      success: true,
      requestBody: body,
    });

    // 201 for somebody this call added, 200 for somebody already here. A
    // directory replays its own state, and answering 201 every time would
    // tell it something was created that was not.
    return NextResponse.json(asResource(member, body.externalId), {
      status: created ? 201 : 200,
      headers: SCIM_HEADERS,
    });
  } catch (error) {
    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "User",
      operation: "CREATE",
      externalId: body.externalId ?? email,
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      requestBody: body,
    });

    return NextResponse.json(scimError(500, "Failed to provision user"), {
      status: 500,
      headers: SCIM_HEADERS,
    });
  }
}
