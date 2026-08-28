/**
 * Polling a device login (RFC 8628, P5-T07c-b).
 *
 * **Unauthenticated, and the device code is the credential.** A terminal holding
 * one gets whatever that code was granted and nothing else. The code is hashed
 * at rest, so this endpoint is the only thing that can turn it into a token, and
 * only once.
 *
 * **The answers are the protocol's own.** `authorization_pending`, `slow_down`,
 * `expired_token` and `access_denied` are RFC 8628's names, carried as the
 * `error.code` this surface uses everywhere else, so a client that already
 * speaks the protocol needs no special case and a client that speaks only this
 * API's error shape needs none either.
 *
 * A 400 for every refusal, which is what the RFC specifies for this endpoint. A
 * pending poll is not a failure of the request; it is the protocol working.
 */
import { pollDeviceAuthorisation } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../../../../lib/pool";

export const dynamic = "force-dynamic";

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** RFC 8628 §3.5, plus the two this product adds for a code it cannot place. */
const REFUSALS = {
  pending: {
    code: "authorization_pending",
    message: "Nobody has approved this yet.",
  },
  slow_down: {
    code: "slow_down",
    message: "Polling faster than the interval. Wait and try again.",
  },
  expired: {
    code: "expired_token",
    message: "That login expired. Start another one.",
  },
  denied: {
    code: "access_denied",
    message: "That login was refused in the browser.",
  },
  invalid: {
    code: "invalid_grant",
    message: "That is not a login this instance is waiting on.",
  },
} as const;

export async function POST(request: NextRequest): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(
      { error: { code: "invalid_request", message: "The body must be JSON." } },
      400,
    );
  }

  const deviceCode =
    typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
  if (deviceCode === "") {
    return json(
      {
        error: {
          code: "invalid_request",
          message: "deviceCode is required.",
        },
      },
      400,
    );
  }

  const grant = await pollDeviceAuthorisation(getPool(), {
    deviceCode,
    now: new Date(),
  });

  if (grant.kind === "granted") {
    // The only time this token exists outside the terminal that asked for it.
    return json({ data: { token: grant.token, name: grant.name } }, 200);
  }
  return json({ error: REFUSALS[grant.kind] }, 400);
}
