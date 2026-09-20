import {
  type DirectoryGroup,
  listDirectoryGroups,
  logSyncOperation,
  type SCIMGroup,
  scimError,
  scimList,
  syncDirectoryGroup,
} from "@openokr/core";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/auth";
import { authenticateScim } from "../Users/route";

/**
 * SCIM 2.0 Groups collection (P8-T08b, RFC 7644 §3.3, §3.4.2).
 *
 * POST provisions a group as a space. GET lists the mapped groups, and
 * answers the `displayName eq` filter a provider uses to find one before it
 * creates it.
 *
 * A group is a space, and its membership is the space's membership. Losing a
 * group is not losing the workspace: the Users resource decides that.
 */
export const dynamic = "force-dynamic";

const SCIM_HEADERS = { "Content-Type": "application/scim+json" };

const DISPLAY_NAME_FILTER = /^\s*displayName\s+eq\s+"([^"]*)"\s*$/i;

/** One mapped group as a SCIM Group resource. */
export const asGroupResource = (group: DirectoryGroup) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  id: group.groupId,
  externalId: group.externalId,
  displayName: group.displayName,
  members: group.memberIds.map((memberId) => ({ value: memberId })),
});

/** The member ids a SCIM group body names. */
export const memberIdsFrom = (
  body: SCIMGroup,
): readonly string[] | undefined =>
  body.members
    ? body.members
        .map((member) => member.value)
        .filter((value): value is string => typeof value === "string")
    : undefined;

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const filter = new URL(request.url).searchParams.get("filter");
  const groups = await listDirectoryGroups(getPool(), auth.workspaceId);

  if (!filter) {
    return NextResponse.json(scimList(groups.map(asGroupResource)), {
      headers: SCIM_HEADERS,
    });
  }

  const match = DISPLAY_NAME_FILTER.exec(filter);
  if (!match) {
    return NextResponse.json(
      scimError(400, "Only a displayName eq filter is supported"),
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  const wanted = (match[1] ?? "").toLowerCase();
  return NextResponse.json(
    scimList(
      groups
        .filter((group) => group.displayName.toLowerCase() === wanted)
        .map(asGroupResource),
    ),
    { headers: SCIM_HEADERS },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  let body: SCIMGroup;
  try {
    body = (await request.json()) as SCIMGroup;
  } catch {
    return NextResponse.json(scimError(400, "Invalid JSON"), {
      status: 400,
      headers: SCIM_HEADERS,
    });
  }

  const displayName = body.displayName?.trim();
  if (!displayName) {
    return NextResponse.json(scimError(400, "displayName is required"), {
      status: 400,
      headers: SCIM_HEADERS,
    });
  }

  // A group with no id of its own is identified by its name. Providers that
  // send one use it, and the fallback keeps a second sync from making a
  // second space.
  const externalId = body.externalId?.trim() || `name:${displayName}`;

  try {
    const group = await syncDirectoryGroup(getPool(), {
      workspaceId: auth.workspaceId,
      externalId,
      displayName,
      ...(memberIdsFrom(body) ? { memberIds: memberIdsFrom(body) } : {}),
    });

    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "Group",
      operation: "CREATE",
      externalId,
      localId: group.spaceId,
      success: true,
      requestBody: body,
    });

    return NextResponse.json(asGroupResource(group), {
      status: 201,
      headers: SCIM_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "Group",
      operation: "CREATE",
      externalId,
      success: false,
      errorMessage: message,
      requestBody: body,
    });

    return NextResponse.json(scimError(500, "Failed to provision group"), {
      status: 500,
      headers: SCIM_HEADERS,
    });
  }
}
