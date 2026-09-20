import { loadEnv } from "@openokr/config";
import {
  ACCESS_LEVELS,
  type CreateSSOConnectionInput,
  createSSOConnection,
  type KeyRing,
  SSOConnectionRejected,
} from "@openokr/core";
import { NextResponse } from "next/server";
import { requireAccessLevel } from "../../../../../lib/access";
import { getPool } from "../../../../../lib/auth";
import { getKeyRing } from "../../../../../lib/secrets";

/**
 * SSO connection management endpoint (P8-T07, extended at P8-T07c-b).
 *
 * POST creates a connection, OIDC or SAML. The client secret is
 * envelope-encrypted before it reaches the database.
 *
 * **What may be stored is decided in `packages/core`, not here.** The route
 * used to hold its own rules and they covered one protocol, so a SAML
 * provider posted to it was refused for having no client secret, which it
 * cannot have. One validator now answers for both and names the field, and
 * the screen shows what it said.
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
    const body = (await request.json()) as Partial<CreateSSOConnectionInput>;

    const input: CreateSSOConnectionInput = {
      kind: body.kind === "saml" ? "saml" : "oidc",
      providerId: String(body.providerId ?? ""),
      displayName: String(body.displayName ?? ""),
      clientId: body.clientId ? String(body.clientId) : "",
      clientSecret: body.clientSecret ? String(body.clientSecret) : "",
      discoveryUrl: body.discoveryUrl ? String(body.discoveryUrl) : null,
      authorizationUrl: body.authorizationUrl
        ? String(body.authorizationUrl)
        : null,
      tokenUrl: body.tokenUrl ? String(body.tokenUrl) : null,
      userInfoUrl: body.userInfoUrl ? String(body.userInfoUrl) : null,
      ...(body.scopes ? { scopes: String(body.scopes) } : {}),
      emailDomains: body.emailDomains ? String(body.emailDomains) : "",
      enforce: body.enforce === true,
      samlEntryPoint: body.samlEntryPoint ? String(body.samlEntryPoint) : null,
      samlIssuer: body.samlIssuer ? String(body.samlIssuer) : null,
      samlCertificate: body.samlCertificate
        ? String(body.samlCertificate)
        : null,
      samlAudience: body.samlAudience ? String(body.samlAudience) : null,
    };

    const ring: KeyRing = getKeyRing();
    const created = await createSSOConnection(
      getPool(),
      workspaceId,
      ring,
      input,
      loadEnv().BETTER_AUTH_URL,
    );

    return NextResponse.json(
      { ok: true, providerId: created.providerId },
      { status: 201 },
    );
  } catch (error) {
    // A configuration the product will not store, with the field to correct.
    // The screen puts the message beside that field rather than at the top.
    if (error instanceof SSOConnectionRejected) {
      return NextResponse.json(
        { error: error.message, field: error.field },
        { status: 400 },
      );
    }
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
