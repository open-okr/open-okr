import {
  ACCESS_LEVELS,
  createSSOConnection,
  type KeyRing,
} from "@openokr/core";
import { NextResponse } from "next/server";
import { requireAccessLevel } from "../../../../../lib/access";
import { getPool } from "../../../../../lib/auth";
import { getKeyRing } from "../../../../../lib/secrets";

/**
 * SSO connection management endpoint (P8-T07).
 *
 * POST creates a new connection. The client secret is envelope-encrypted
 * before it reaches the database.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // **The workspace comes from here, not from the connection** (audit,
    // 18 September 2026). This route used to insert with
    // `current_setting('app.workspace_id')` on a bare pool, which raises
    // rather than returning null, so no SSO provider could ever be created on
    // any instance. `requireAccessLevel` has returned the workspace all
    // along; the route discarded it and asked the database instead.
    const { workspaceId } = await requireAccessLevel(ACCESS_LEVELS.full);
    const body = await request.json();

    const {
      providerId,
      displayName,
      discoveryUrl,
      authorizationUrl,
      tokenUrl,
      userInfoUrl,
      clientId,
      clientSecret,
      scopes,
      emailDomains,
      enforce,
    } = body as {
      providerId?: string;
      displayName?: string;
      discoveryUrl?: string;
      authorizationUrl?: string;
      tokenUrl?: string;
      userInfoUrl?: string;
      clientId?: string;
      clientSecret?: string;
      scopes?: string;
      emailDomains?: string;
      enforce?: boolean;
    };

    if (!providerId || !displayName || !clientId || !clientSecret) {
      return NextResponse.json(
        {
          error:
            "providerId, displayName, clientId and clientSecret are required",
        },
        { status: 400 },
      );
    }

    // Validate provider ID format: alphanumeric and hyphens only.
    if (!/^[a-z0-9-]+$/.test(providerId)) {
      return NextResponse.json(
        { error: "Provider ID must be lowercase alphanumeric with hyphens" },
        { status: 400 },
      );
    }

    // At least one of discoveryUrl or authorizationUrl+tokenUrl is required.
    if (!discoveryUrl && (!authorizationUrl || !tokenUrl)) {
      return NextResponse.json(
        {
          error:
            "Either a discovery URL or both authorization URL and token URL are required",
        },
        { status: 400 },
      );
    }

    const ring: KeyRing = getKeyRing();

    await createSSOConnection(getPool(), workspaceId, ring, {
      providerId,
      displayName,
      clientId,
      clientSecret,
      discoveryUrl: discoveryUrl || null,
      authorizationUrl: authorizationUrl || null,
      tokenUrl: tokenUrl || null,
      userInfoUrl: userInfoUrl || null,
      ...(scopes ? { scopes } : {}),
      ...(emailDomains ? { emailDomains } : {}),
      ...(enforce === undefined ? {} : { enforce }),
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    // Duplicate provider ID.
    if (
      error instanceof Error &&
      error.message.includes("sso_connections_provider")
    ) {
      return NextResponse.json(
        { error: "A provider with that ID already exists in this workspace" },
        { status: 409 },
      );
    }
    console.error("SSO connection creation failed:", error);
    return NextResponse.json(
      { error: "Failed to create SSO connection" },
      { status: 500 },
    );
  }
}
