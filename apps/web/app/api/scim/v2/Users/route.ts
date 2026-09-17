import {
  logSyncOperation,
  resolveSCIMToken,
  type SCIMUser,
  scimDisplayName,
  scimError,
  scimList,
  scimPrimaryEmail,
} from "@openokr/core";
import { NextResponse } from "next/server";
import { getPool } from "../../../../../lib/auth";

/**
 * SCIM 2.0 Users endpoint (P8-T08, RFC 7644 SS3.3).
 *
 * POST /api/scim/v2/Users - provision a user as a workspace member.
 * GET  /api/scim/v2/Users - list members (for the identity provider to
 *      reconcile its state).
 *
 * The bearer token resolves to a workspace. Every operation runs in that
 * workspace context.
 */
export const dynamic = "force-dynamic";

async function authenticateScim(
  request: Request,
): Promise<{ workspaceId: string } | NextResponse> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return NextResponse.json(scimError(401, "Bearer token required"), {
      status: 401,
    });
  }
  const token = auth.slice(7);
  const resolved = await resolveSCIMToken(getPool(), token);
  if (!resolved) {
    return NextResponse.json(scimError(401, "Invalid or expired token"), {
      status: 401,
    });
  }
  return { workspaceId: resolved.workspaceId };
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const pool = getPool();
  // List active members as SCIM User resources.
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    name: string;
    email: string;
    status: string;
  }>(
    `SELECT wm.id, wm.user_id, wm.name,
            u.email, wm.status
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = $1
        AND wm.deleted_at IS NULL
        AND wm.kind = 'human'
      ORDER BY wm.created_at`,
    [auth.workspaceId],
  );

  const resources = rows.map((row) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: row.id,
    externalId: row.user_id,
    userName: row.email,
    displayName: row.name,
    active: row.status === "active",
    emails: [{ value: row.email, primary: true, type: "work" }],
  }));

  return NextResponse.json(scimList(resources), {
    headers: { "Content-Type": "application/scim+json" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticateScim(request);
  if (auth instanceof NextResponse) return auth;

  const pool = getPool();
  let body: SCIMUser;
  try {
    body = (await request.json()) as SCIMUser;
  } catch {
    return NextResponse.json(scimError(400, "Invalid JSON"), { status: 400 });
  }

  const email = scimPrimaryEmail(body);
  const name = scimDisplayName(body);

  if (!email) {
    return NextResponse.json(scimError(400, "No email found in the request"), {
      status: 400,
    });
  }

  try {
    // Check if the user already exists in the auth system.
    const { rows: existingUsers } = await pool.query<{
      id: string;
      email: string;
    }>("SELECT id, email FROM users WHERE email = $1", [email.toLowerCase()]);

    let userId: string;

    if (existingUsers.length > 0 && existingUsers[0]) {
      userId = existingUsers[0].id;
    } else {
      // Create the user through Better Auth's table directly. This is a
      // SCIM provisioning operation, not a sign-up: the user has no
      // password and must sign in through SSO. The account is created so
      // provisionMemberForInvite can find it.
      const { rows: created } = await pool.query<{ id: string }>(
        `INSERT INTO users (id, name, email, email_verified, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, true, now(), now())
         RETURNING id`,
        [name, email.toLowerCase()],
      );
      const createdRow = created[0];
      if (!createdRow) throw new Error("User insert returned no row");
      userId = createdRow.id;
    }

    // Check if the user is already a member of this workspace.
    const { rows: existingMembers } = await pool.query<{
      id: string;
      status: string;
    }>(
      `SELECT id, status FROM workspace_members
        WHERE workspace_id = $1 AND user_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [auth.workspaceId, userId],
    );

    let memberId: string | undefined;

    if (existingMembers.length > 0 && existingMembers[0]) {
      memberId = existingMembers[0].id;
      // If the member was suspended, reactivate them.
      if (existingMembers[0].status === "suspended") {
        await pool.query(
          `UPDATE workspace_members SET status = 'active', updated_at = now()
            WHERE id = $1`,
          [memberId],
        );
      }
    } else {
      // Create the member. A direct insert, because SCIM provisioning
      // runs as a system actor outside the normal request pipeline. The
      // member gets the default settings.
      const { rows: newMembers } = await pool.query<{ id: string }>(
        `INSERT INTO workspace_members
          (id, workspace_id, user_id, name, kind, status, primary_channel,
           created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'human', 'active', 'in_app',
                 now(), now())
         RETURNING id`,
        [auth.workspaceId, userId, name],
      );
      memberId = newMembers[0]?.id;
    }

    await logSyncOperation(pool, auth.workspaceId, {
      resourceType: "User",
      operation: "CREATE",
      externalId: body.externalId ?? email,
      localId: memberId,
      success: true,
      requestBody: body,
    });

    const scimUser = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: memberId ?? userId,
      externalId: body.externalId ?? email,
      userName: email,
      displayName: name,
      active: true,
      emails: [{ value: email, primary: true, type: "work" }],
    };

    return NextResponse.json(scimUser, {
      status: 201,
      headers: { "Content-Type": "application/scim+json" },
    });
  } catch (error) {
    await logSyncOperation(pool, auth.workspaceId, {
      resourceType: "User",
      operation: "CREATE",
      externalId: body.externalId ?? email ?? "unknown",
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
      requestBody: body,
    });

    return NextResponse.json(scimError(500, "Failed to provision user"), {
      status: 500,
    });
  }
}
