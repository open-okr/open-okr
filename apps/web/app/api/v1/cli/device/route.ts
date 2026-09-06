/**
 * Starting a device login (RFC 8628, TECHNICAL-PLAN §14, P5-T07c-b).
 *
 * **Unauthenticated on purpose.** A terminal running `okr login` has nothing to
 * authenticate with; getting something is the point. What bounds it is a rate
 * limit per caller address and a ten-minute code that grants nothing until a
 * signed-in person approves it in a browser.
 *
 * A static route rather than the catch-all beside it, because this is protocol
 * rather than a projection of the action registry: it has no actor, so it cannot
 * be a registry action, and pretending otherwise would put an unauthenticated
 * hole in a surface whose whole shape is "every call is somebody".
 */
import { loadEnv } from "@openokr/config";
import {
  API_RATE_WINDOW_SECONDS,
  apiError,
  startDeviceAuthorisation,
  statusFor,
} from "@openokr/core";
import { TOKEN_SCOPES, type TokenScope } from "@openokr/db";
import type { NextRequest } from "next/server";
import { getCache } from "../../../../../lib/cache";
import { getPool } from "../../../../../lib/pool";

export const dynamic = "force-dynamic";

/**
 * How many requests one address may start per window.
 *
 * Lower than the read limit on the rest of the surface, because each of these
 * writes a row and nobody legitimately starts thirty logins a minute.
 */
const START_LIMIT = 10;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** The caller's address, through whatever proxy is in front. */
function callerAddress(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

/** The scopes asked for, refusing anything that is not one. */
function scopesFrom(value: unknown): readonly TokenScope[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const scopes = value.filter((one): one is TokenScope =>
    (TOKEN_SCOPES as readonly string[]).includes(one as string),
  );
  return scopes.length === value.length ? scopes : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const limited = await getCache().rateLimit(
    `device:start:${callerAddress(request)}`,
    START_LIMIT,
    API_RATE_WINDOW_SECONDS,
  );
  if (!limited.allowed) {
    const error = apiError(
      "rate_limited",
      "That is a lot of logins at once. Try again shortly.",
    );
    return json({ error }, statusFor(error.code));
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    const error = apiError("invalid_input", "The body must be a JSON object.");
    return json({ error }, statusFor(error.code));
  }

  const scopes = scopesFrom(body.scopes);
  if (!scopes) {
    const error = apiError(
      "invalid_input",
      `scopes must be a non-empty list drawn from ${TOKEN_SCOPES.join(", ")}.`,
    );
    return json({ error }, statusFor(error.code));
  }

  const clientName =
    typeof body.clientName === "string" && body.clientName.trim() !== ""
      ? body.clientName.trim()
      : "an unnamed terminal";

  const started = await startDeviceAuthorisation(getPool(), {
    clientName,
    scopes,
    // The instance's own address, so the URL a person is told to open is this
    // instance rather than whatever host header a caller sent.
    baseUrl: loadEnv().BETTER_AUTH_URL,
    now: new Date(),
  });

  return json(
    {
      data: {
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        verificationUri: started.verificationUri,
        expiresIn: started.expiresIn,
        interval: started.interval,
      },
    },
    200,
  );
}
