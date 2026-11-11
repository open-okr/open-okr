import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { NextResponse } from "next/server";
import { requireAccessLevel } from "../../../../../../lib/access";
import { getPool } from "../../../../../../lib/auth";
import { refuseCrossSite } from "../../../../../../lib/same-origin";

/**
 * SCIM token generation endpoint (P8-T08).
 *
 * POST creates a new SCIM bearer token for the workspace through the audited
 * `directory.createToken` action. Any previous live token is revoked. The plaintext token is returned once and never
 * stored.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const crossSite = refuseCrossSite(request);
  if (crossSite) {
    return crossSite;
  }
  try {
    const access = await requireAccessLevel(ACCESS_LEVELS.full);
    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
    };

    // The token is in this answer once. The audit row names who minted it and
    // never carries it.
    const { token, id } = await callAction(
      {
        pool: getPool(),
        workspaceId: access.workspaceId,
        actor: { kind: "human", userId: access.userId },
      },
      "directory.createToken",
      typeof body.label === "string" ? { label: body.label } : {},
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
