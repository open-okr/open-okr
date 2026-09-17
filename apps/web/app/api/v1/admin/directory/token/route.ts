import { ACCESS_LEVELS, createSCIMToken } from "@openokr/core";
import { NextResponse } from "next/server";
import { requireAccessLevel } from "../../../../../../lib/access";
import { getPool } from "../../../../../../lib/auth";

/**
 * SCIM token generation endpoint (P8-T08).
 *
 * POST creates a new SCIM bearer token for the workspace. Any previous
 * live token is revoked. The plaintext token is returned once and never
 * stored.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const access = await requireAccessLevel(ACCESS_LEVELS.full);
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
    };

    const { token, id } = await createSCIMToken(
      getPool(),
      access.workspaceId,
      body.label,
    );

    return NextResponse.json({ token, id }, { status: 201 });
  } catch (error) {
    console.error("SCIM token generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate SCIM token" },
      { status: 500 },
    );
  }
}
