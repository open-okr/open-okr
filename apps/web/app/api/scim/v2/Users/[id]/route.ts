import {
  logSyncOperation,
  memberById,
  type SCIMUser,
  scimError,
  setDirectoryUserActive,
} from "@openokr/core";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../../lib/auth";
import { asResource, authenticateScim } from "../route";

/**
 * SCIM 2.0 one User (P8-T08a; RFC 7644 §3.4.2, §3.5.2, §3.6).
 *
 * GET    read one member.
 * PATCH  the deactivation an identity provider sends when somebody leaves.
 * PUT    a full replace, which for this surface is the same `active` question.
 * DELETE the other way a provider says the same thing.
 *
 * **Deactivation maps to suspension and never to deletion**, which is the
 * P8-T08 acceptance criterion and had no code path at all until this file.
 * `DELETE` answers 204 and suspends, because a directory that believes it
 * deleted somebody and a workspace that keeps their authorship are both
 * right: suspension removes every access without erasing what they wrote.
 */
export const dynamic = "force-dynamic";

const SCIM_HEADERS = { "Content-Type": "application/scim+json" };

/** The `active` value a PATCH or PUT is asking for, or null. */
function activeFrom(body: unknown): boolean | null {
  const patch = body as {
    Operations?: Array<{
      op?: string;
      path?: string;
      value?: unknown;
    }>;
    active?: unknown;
  };

  // A PUT, or a PATCH that sent the whole resource.
  if (typeof patch.active === "boolean") {
    return patch.active;
  }

  // RFC 7644 §3.5.2 patch operations. Okta sends
  // `{op: "replace", value: {active: false}}`, Entra sends
  // `{op: "Replace", path: "active", value: false}`, and the value arrives as
  // a string from more than one provider.
  for (const operation of patch.Operations ?? []) {
    if ((operation.op ?? "").toLowerCase() !== "replace") {
      continue;
    }
    const value = operation.value;
    if ((operation.path ?? "").toLowerCase() === "active") {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      continue;
    }
    const nested = (value as { active?: unknown } | undefined)?.active;
    if (typeof nested === "boolean") return nested;
    if (nested === "true") return true;
    if (nested === "false") return false;
  }

  return null;
}

async function setActive(
  request: Request,
  memberId: string,
  active: boolean,
  body: unknown,
): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const existing = await memberById(getPool(), auth.workspaceId, memberId);
  if (!existing) {
    return NextResponse.json(scimError(404, "No such user"), {
      status: 404,
      headers: SCIM_HEADERS,
    });
  }

  try {
    // Already in the state the directory is asking for. Saying so without
    // writing keeps a reconciliation run from filling the audit trail with
    // suspensions of somebody who was already suspended.
    const member =
      existing.active === active
        ? existing
        : await setDirectoryUserActive(getPool(), {
            workspaceId: auth.workspaceId,
            memberId,
            active,
          });

    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "User",
      operation: active ? "REACTIVATE" : "DEACTIVATE",
      externalId: member.userId,
      localId: member.memberId,
      success: true,
      requestBody: body,
    });

    return NextResponse.json(asResource(member), { headers: SCIM_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await logSyncOperation(getPool(), auth.workspaceId, {
      resourceType: "User",
      operation: active ? "REACTIVATE" : "DEACTIVATE",
      externalId: existing.userId,
      localId: memberId,
      success: false,
      errorMessage: message,
      requestBody: body,
    });

    // The one refusal a directory should be able to read and act on: a
    // workspace will not suspend its last full-access holder, because the
    // result would be a workspace nobody can administer.
    return NextResponse.json(scimError(409, message), {
      status: 409,
      headers: SCIM_HEADERS,
    });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  const member = await memberById(getPool(), auth.workspaceId, id);
  if (!member) {
    return NextResponse.json(scimError(404, "No such user"), {
      status: 404,
      headers: SCIM_HEADERS,
    });
  }
  return NextResponse.json(asResource(member), { headers: SCIM_HEADERS });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  let body: SCIMUser | unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(scimError(400, "Invalid JSON"), {
      status: 400,
      headers: SCIM_HEADERS,
    });
  }

  const active = activeFrom(body);
  if (active === null) {
    // Attributes other than `active` are the directory's to hold. A person's
    // name here is theirs to edit, and a profile this surface silently
    // overwrote on every sync would be a worse surprise than a 400.
    return NextResponse.json(
      scimError(400, "Only the active attribute can be patched"),
      { status: 400, headers: SCIM_HEADERS },
    );
  }

  return setActive(request, id, active, body);
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
  const { id } = await context.params;
  const response = await setActive(request, id, false, { op: "delete" });
  if (response.status >= 400) {
    return response;
  }
  // 204, which is what RFC 7644 §3.6 says a delete answers. The member is
  // suspended rather than removed, and the directory needs no body to know
  // its request was carried out.
  return new NextResponse(null, { status: 204 });
}
