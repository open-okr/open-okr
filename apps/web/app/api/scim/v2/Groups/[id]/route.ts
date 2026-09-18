import {
  directoryGroupById,
  logSyncOperation,
  type SCIMGroup,
  scimError,
  syncDirectoryGroup,
  unmapDirectoryGroup,
} from "@openokr/core";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../../lib/auth";
import { authenticateScim } from "../../Users/route";
import { asGroupResource, memberIdsFrom } from "../route";

/**
 * SCIM 2.0 one Group (P8-T08b, RFC 7644 §3.4.2, §3.5.2, §3.6).
 *
 * GET reads it, PATCH applies the add, remove and replace a provider sends
 * for membership, PUT replaces the whole membership, and DELETE unmaps the
 * group: everybody leaves the space and the space stays.
 */
export const dynamic = "force-dynamic";

const SCIM_HEADERS = { "Content-Type": "application/scim+json" };

/** `members[value eq "abc"]` names one member to remove. */
const MEMBER_PATH = /^members\[\s*value\s+eq\s+"([^"]*)"\s*\]$/i;

/**
 * The membership a PATCH leaves behind, applied to what is there now.
 *
 * RFC 7644 §3.5.2 in the shapes providers send it. Okta removes with a
 * filtered path and adds with a value array; Entra replaces the whole list.
 * Returns null when the body asks for something this surface does not apply,
 * so the caller can refuse rather than half-apply it.
 */
export function membershipAfterPatch(
  current: readonly string[],
  body: unknown,
): readonly string[] | null {
  const operations = (body as { Operations?: unknown }).Operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    return null;
  }

  let next = [...current];

  for (const raw of operations) {
    const operation = raw as { op?: string; path?: string; value?: unknown };
    const op = (operation.op ?? "").toLowerCase();
    const path = operation.path ?? "";

    const values = Array.isArray(operation.value)
      ? operation.value
          .map((entry) => (entry as { value?: unknown }).value)
          .filter((value): value is string => typeof value === "string")
      : [];

    const filtered = MEMBER_PATH.exec(path);

    if (op === "add" && (path === "" || path.toLowerCase() === "members")) {
      next = [...new Set([...next, ...values])];
      continue;
    }
    if (op === "remove" && filtered) {
      const gone = filtered[1];
      next = next.filter((memberId) => memberId !== gone);
      continue;
    }
    if (op === "remove" && path.toLowerCase() === "members") {
      next =
        values.length === 0 ? [] : next.filter((id) => !values.includes(id));
      continue;
    }
    if (op === "replace" && path.toLowerCase() === "members") {
      next = [...new Set(values)];
      continue;
    }
    // A rename arrives as a replace on displayName and is handled by the
    // caller, which reads the name off the body directly.
    if (op === "replace" && path.toLowerCase() === "displayname") {
      continue;
    }
    return null;
  }

  return next;
}

/** The name a PATCH or PUT is setting, if it sets one. */
function displayNameFrom(body: unknown): string | undefined {
  const direct = (body as { displayName?: unknown }).displayName;
  if (typeof direct === "string" && direct.trim() !== "") {
    return direct.trim();
  }
  const operations = (body as { Operations?: unknown }).Operations;
  if (!Array.isArray(operations)) {
    return undefined;
  }
  for (const raw of operations) {
    const operation = raw as { op?: string; path?: string; value?: unknown };
    if (
      (operation.op ?? "").toLowerCase() === "replace" &&
      (operation.path ?? "").toLowerCase() === "displayname" &&
      typeof operation.value === "string" &&
      operation.value.trim() !== ""
    ) {
      return operation.value.trim();
    }
  }
  return undefined;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  const group = await directoryGroupById(getPool(), auth.workspaceId, id);
  if (!group) {
    return NextResponse.json(scimError(404, "No such group"), {
      status: 404,
      headers: SCIM_HEADERS,
    });
  }
  return NextResponse.json(asGroupResource(group), { headers: SCIM_HEADERS });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  let body: SCIMGroup | unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(scimError(400, "Invalid JSON"), {
      status: 400,
      headers: SCIM_HEADERS,
    });
  }

  const group = await directoryGroupById(getPool(), auth.workspaceId, id);
  if (!group) {
    return NextResponse.json(scimError(404, "No such group"), {
      status: 404,
      headers: SCIM_HEADERS,
    });
  }

  // A PUT sends the whole resource; a PATCH sends operations. Both end as one
  // membership list and one name.
  const whole = memberIdsFrom(body as SCIMGroup);
  const memberIds =
    whole ?? membershipAfterPatch(group.memberIds, body) ?? undefined;
  const displayName = displayNameFrom(body) ?? group.displayName;

  if (!memberIds && displayName === group.displayName) {
    return NextResponse.json(
      scimError(400, "Only members and displayName can be patched"),
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  try {
    const updated = await syncDirectoryGroup(getPool(), {
      workspaceId: auth.workspaceId,
      externalId: group.externalId,
      displayName,
      ...(memberIds ? { memberIds } : {}),
    });

    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "Group",
      operation: "UPDATE",
      externalId: group.externalId,
      localId: group.spaceId,
      success: true,
      requestBody: body,
    });

    return NextResponse.json(asGroupResource(updated), {
      headers: SCIM_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "Group",
      operation: "UPDATE",
      externalId: group.externalId,
      localId: group.spaceId,
      success: false,
      errorMessage: message,
      requestBody: body,
    });
    return NextResponse.json(scimError(500, "Failed to update group"), {
      status: 500,
      headers: SCIM_HEADERS,
    });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return PATCH(request, context);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  const group = await directoryGroupById(getPool(), auth.workspaceId, id);
  const unmapped = await unmapDirectoryGroup(getPool(), auth.workspaceId, id);
  if (!unmapped) {
    return NextResponse.json(scimError(404, "No such group"), {
      status: 404,
      headers: SCIM_HEADERS,
    });
  }

  await logSyncOperation(getPool(), auth.workspaceId, {
    resourceType: "Group",
    operation: "DELETE",
    externalId: group?.externalId ?? id,
    localId: group?.spaceId,
    success: true,
  });

  return new NextResponse(null, { status: 204 });
}
