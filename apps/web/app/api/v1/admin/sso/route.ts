import { ACCESS_LEVELS, encryptSecret, type KeyRing } from "@openokr/core";
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
    await requireAccessLevel(ACCESS_LEVELS.full);
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
    const sealed = encryptSecret(ring, clientSecret);

    const pool = getPool();
    await pool.query(
      `insert into sso_connections (
        workspace_id, provider_id, display_name,
        discovery_url, authorization_url, token_url, user_info_url,
        client_id, secret_ciphertext, secret_data_key, secret_key_id,
        scopes, email_domains, enforce
      ) values (
        current_setting('app.workspace_id')::uuid, $1, $2,
        $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13
      )`,
      [
        providerId,
        displayName,
        discoveryUrl || null,
        authorizationUrl || null,
        tokenUrl || null,
        userInfoUrl || null,
        clientId,
        sealed.ciphertext,
        sealed.dataKey,
        sealed.keyId,
        scopes || "openid email profile",
        emailDomains || "",
        enforce ?? false,
      ],
    );

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
