/**
 * Dynamic client registration (RFC 7591, P5-T08b).
 *
 * **Open, and that is not a hole.** Registering grants nothing: it records a
 * name and a set of redirect addresses. Every authority still comes from a
 * person approving a specific client, in a specific workspace, with specific
 * scopes, on the consent screen. What this buys is that an agent nobody has
 * heard of can start the flow without an operator pasting anything.
 *
 * **The one dangerous part is `client_uri`**, a document address a stranger
 * chose. Fetching it is the request-forgery problem in its plainest form, so it
 * goes through the outbound guard: literal host and every resolved address
 * checked, no redirect followed, size and time capped.
 */
import { outboundFetch } from "@openokr/adapters";
import { loadEnv } from "@openokr/config";
import {
  parseClientMetadata,
  registerClientForInstance,
  registrationResponse,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../lib/pool";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(
      {
        error: "invalid_client_metadata",
        error_description: "The request body could not be read as JSON.",
      },
      400,
    );
  }

  const env = loadEnv();
  const requireTransportSecurity = env.NODE_ENV === "production";

  let clientName = typeof body.client_name === "string" ? body.client_name : "";
  let redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const metadataUrl =
    typeof body.client_uri === "string" ? body.client_uri : undefined;

  // A client may describe itself by pointing at a document instead of putting
  // everything in the body. What comes back is untrusted and read defensively,
  // and the fetch obeys every outbound rule.
  if (redirectUris.length === 0 && metadataUrl) {
    const fetched = await outboundFetch(metadataUrl, { maxBytes: 64 * 1024 });
    if (!fetched.ok) {
      return json(
        {
          error: "invalid_client_metadata",
          error_description: `That client document could not be read: ${fetched.detail}`,
        },
        400,
      );
    }
    const parsed = parseClientMetadata(fetched.body);
    if (!parsed) {
      return json(
        {
          error: "invalid_client_metadata",
          error_description:
            "That client document does not list any redirect addresses.",
        },
        400,
      );
    }
    clientName = clientName || parsed.clientName;
    redirectUris = [...parsed.redirectUris];
  }

  const outcome = await registerClientForInstance(getPool(), {
    clientName,
    redirectUris,
    ...(metadataUrl ? { metadataUrl } : {}),
    requireTransportSecurity,
    now: new Date(),
  });

  if (outcome.kind === "refused") {
    return json(
      { error: outcome.error, error_description: outcome.description },
      400,
    );
  }
  return json(registrationResponse(outcome.client), 201);
}
