/**
 * The discovery documents (RFC 8414, RFC 9728, P5-T08b).
 *
 * One handler for all six paths, because the three documents and their
 * transport-suffixed variants are projected from one builder in
 * `packages/core`. Six route files would be six chances for them to disagree
 * about where the token endpoint lives.
 *
 * **Cross-origin preflight is answered, and the documents are readable from
 * anywhere.** They are public metadata by definition: a client that has not
 * authenticated yet is exactly who reads them, and several agent runtimes read
 * them from a browser context. There is nothing here to protect.
 */
import { discoveryDocumentAt } from "@openokr/core";
import type { NextRequest } from "next/server";
import { instanceIssuer } from "../../../lib/issuer";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
} as const;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const document = discoveryDocumentAt(
    `/.well-known/${(path ?? []).join("/")}`,
    instanceIssuer(),
  );

  if (!document) {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json", ...CORS },
    });
  }

  return new Response(JSON.stringify(document), {
    status: 200,
    headers: {
      "content-type": "application/json",
      // Metadata changes when the instance is reconfigured, which is rare, and
      // a client that caches it for an hour is a client that starts faster.
      "cache-control": "public, max-age=3600",
      ...CORS,
    },
  });
}
