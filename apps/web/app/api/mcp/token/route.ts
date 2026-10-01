/**
 * The OAuth token endpoint (RFC 6749 §3.2, P5-T08a).
 *
 * Two grant types and nothing else: `authorization_code`, which a client
 * redeems once after somebody approved it, and `refresh_token`, which rotates.
 * There is no client secret because every client here is public, and no
 * implicit or password grant because both were removed from OAuth 2.1 for
 * reasons this product has no interest in relitigating.
 *
 * **A public endpoint, so nothing it says distinguishes a wrong guess from a
 * near miss.** Every refusal on the code path is `invalid_grant` with a
 * sentence, and the sentence is the same shape whether the code was never
 * issued, has expired, or was redeemed a second ago.
 *
 * **This file is transport and nothing else.** The presented secret names no
 * workspace, so resolving which one it belongs to is a two-step read that has to
 * open its own transaction, and `apps/web` may not do that. Both grant types
 * are one call into `packages/core`, which is also what makes them testable
 * without a running server.
 *
 * **Limited per caller address** (completeness review M-12). Every secret here
 * is 32 random bytes, so the limit is not what stops guessing; it is what stops
 * one address turning a public endpoint into a load on the database. The
 * allowance is the REST surface's rather than registration's, because an office
 * of agents behind one address each refresh when an hour-long access token runs
 * out, and a redemption is one lookup by hash.
 */
import { loadEnv } from "@openokr/config";
import {
  API_RATE_LIMIT,
  API_RATE_WINDOW_SECONDS,
  callerAddress,
  redeemCodeForTokens,
  refreshForTokens,
  resourceIdentifier,
  type TokenOutcome,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getCache } from "../../../../lib/cache";
import { getPool } from "../../../../lib/pool";
import { retryAfter } from "../../../../lib/retry-after";

export const dynamic = "force-dynamic";

const json = (
  body: unknown,
  status: number,
  extra?: Readonly<Record<string, string>>,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // RFC 6749 §5.1: a token response is never cached, anywhere, by anything.
      "cache-control": "no-store",
      pragma: "no-cache",
      ...extra,
    },
  });

const refusal = (error: string, description: string, status = 400): Response =>
  json({ error, error_description: description }, status);

/**
 * The protected resource every grant is bound to.
 *
 * The agent endpoint rather than the instance root, because that is what RFC
 * 9728's metadata names and therefore what a spec-following client sends back
 * as RFC 8707's `resource`.
 */
function instanceResource(): string {
  return resourceIdentifier(loadEnv().BETTER_AUTH_URL);
}

const answer = (outcome: TokenOutcome): Response =>
  outcome.kind === "issued"
    ? json(
        {
          access_token: outcome.tokens.accessToken,
          refresh_token: outcome.tokens.refreshToken,
          token_type: "Bearer",
          expires_in: outcome.tokens.expiresIn,
          scope: outcome.tokens.scopes.join(" "),
        },
        200,
      )
    : refusal(outcome.error, outcome.description);

export async function POST(request: NextRequest): Promise<Response> {
  const limited = await getCache().rateLimit(
    `oauth:token:${callerAddress(request.headers)}`,
    API_RATE_LIMIT,
    API_RATE_WINDOW_SECONDS,
  );
  if (!limited.allowed) {
    // RFC 6749's word for a server refusing for now rather than for good.
    return json(
      {
        error: "temporarily_unavailable",
        error_description:
          "That is a lot of token requests from one address. Try again shortly.",
      },
      429,
      { "retry-after": retryAfter(limited.resetSeconds) },
    );
  }

  // RFC 6749 says form encoding, and every client sends it. A JSON body is
  // accepted as well because several agent runtimes send one, and refusing it
  // would be pedantry that costs a support hour.
  let form: Record<string, string>;
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = (await request.json()) as Record<string, unknown>;
      form = Object.fromEntries(
        Object.entries(body).map(([key, value]) => [key, String(value ?? "")]),
      );
    } else {
      const body = await request.formData();
      form = Object.fromEntries(
        [...body.entries()].map(([key, value]) => [key, String(value)]),
      );
    }
  } catch {
    return refusal("invalid_request", "The request body could not be read.");
  }

  const pool = getPool();
  const now = new Date();
  const resource = instanceResource();
  const grantType = form.grant_type ?? "";

  if (grantType === "authorization_code") {
    const code = form.code ?? "";
    const verifier = form.code_verifier ?? "";
    const redirectUri = form.redirect_uri ?? "";
    if (code === "" || verifier === "" || redirectUri === "") {
      return refusal(
        "invalid_request",
        "A code, a code_verifier and a redirect_uri are all required.",
      );
    }

    return answer(
      await redeemCodeForTokens(pool, {
        code,
        verifier,
        redirectUri,
        resource,
        now,
      }),
    );
  }

  if (grantType === "refresh_token") {
    const raw = form.refresh_token ?? "";
    if (raw === "") {
      return refusal("invalid_request", "A refresh_token is required.");
    }

    return answer(
      await refreshForTokens(pool, { refreshToken: raw, resource, now }),
    );
  }

  return refusal(
    "unsupported_grant_type",
    "This server supports authorization_code and refresh_token.",
  );
}
