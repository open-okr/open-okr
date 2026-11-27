/**
 * The FlowyTeam gateway over HTTPS (docs/design/flowyteam-connect.md §3, §6).
 *
 * **Every request goes through `outboundFetch`**, so the address is checked,
 * no redirect is followed and the answer is capped, and the air-gap checklist
 * sees it. No vendor SDK: FlowyTeam speaks plain OAuth 2.0 and JSON.
 *
 * **No token is ever logged or put in a `detail`.** A detail names the status
 * and FlowyTeam's error code at most, because it reaches an operator's log.
 */
import {
  type OutboundOptions,
  type OutboundResult,
  outboundFetch,
} from "../../outbound/guard.ts";
import type {
  FlowyteamAnswer,
  FlowyteamFailure,
  FlowyteamGateway,
} from "../../ports/flowyteam.ts";

export interface HttpFlowyteamGatewayOptions {
  /**
   * Lets the FlowyTeam address be inside the network. A self-hosted instance
   * next to its own FlowyTeam needs it; the managed cloud does not.
   */
  readonly allowPrivate?: boolean;
  readonly timeoutMs?: number;
  /** For tests: see `OutboundOptions`. */
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: OutboundOptions["resolve"];
}

const DEFAULT_TIMEOUT_MS = 15_000;

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function failureFor(status: number): FlowyteamFailure {
  if (status === 409) return "version_mismatch";
  if (status === 401 || status === 403) return "unauthorised";
  if (status >= 500 || status === 429) return "unreachable";
  return "refused";
}

/** FlowyTeam's own error code, when it sent one. Never the description. */
function errorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error.slice(0, 60) : null;
  } catch {
    return null;
  }
}

function failed<T>(
  result: OutboundResult,
  what: string,
): FlowyteamAnswer<T> | null {
  if (!result.ok) {
    return {
      ok: false,
      failure: "unreachable",
      detail: `${what}: ${result.refusal}, ${result.detail}`,
    };
  }
  if (result.status >= 200 && result.status < 300) {
    return null;
  }
  const code = errorCode(result.body);
  return {
    ok: false,
    failure: failureFor(result.status),
    status: result.status,
    detail: `${what} answered ${result.status}${code ? ` (${code})` : ""}`,
  };
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createHttpFlowyteamGateway(
  options: HttpFlowyteamGatewayOptions = {},
): FlowyteamGateway {
  const send = (url: string, init: Partial<OutboundOptions>) =>
    outboundFetch(url, {
      method: "POST",
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(options.allowPrivate ? { allowPrivate: true } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.resolve ? { resolve: options.resolve } : {}),
      ...init,
    });

  const form = (fields: Record<string, string | undefined>) => {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== "") {
        body.set(key, value);
      }
    }
    return {
      body: body.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    };
  };

  return {
    async exchangeCode(input) {
      const result = await send(
        endpoint(input.baseUrl, "/oauth/token"),
        form({
          grant_type: "authorization_code",
          code: input.code,
          redirect_uri: input.redirectUri,
          client_id: input.clientId,
          client_secret: input.clientSecret,
          code_verifier: input.codeVerifier,
        }),
      );
      const failure = failed<{ accessToken: string; scope: string }>(
        result,
        "the FlowyTeam token endpoint",
      );
      if (failure || !result.ok) {
        return (
          failure ?? {
            ok: false,
            failure: "unreachable",
            detail: "the FlowyTeam token endpoint did not answer",
          }
        );
      }
      const parsed = parseJson(result.body);
      const token = parsed?.access_token;
      if (typeof token !== "string" || token === "") {
        return {
          ok: false,
          failure: "bad_answer",
          detail:
            "the FlowyTeam token endpoint answered without an access token",
        };
      }
      return {
        ok: true,
        value: {
          accessToken: token,
          scope: typeof parsed?.scope === "string" ? parsed.scope : "",
        },
      };
    },

    async readCompany(input) {
      const result = await send(
        endpoint(input.baseUrl, "/api/export/v1/query"),
        {
          body: JSON.stringify({
            version: input.version,
            name: "companies.byId",
            values: [],
            cursor: null,
          }),
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${input.accessToken}`,
          },
        },
      );
      const failure = failed<{ companyId: string; companyName: string }>(
        result,
        "the FlowyTeam export endpoint",
      );
      if (failure || !result.ok) {
        return (
          failure ?? {
            ok: false,
            failure: "unreachable",
            detail: "the FlowyTeam export endpoint did not answer",
          }
        );
      }
      const parsed = parseJson(result.body);
      const rows = parsed?.rows;
      const first =
        Array.isArray(rows) && typeof rows[0] === "object" && rows[0] !== null
          ? (rows[0] as Record<string, unknown>)
          : null;
      const id = first?.id;
      const name = first?.company_name;
      if (
        (typeof id !== "number" && typeof id !== "string") ||
        String(id).trim() === "" ||
        typeof name !== "string" ||
        name.trim() === ""
      ) {
        return {
          ok: false,
          failure: "bad_answer",
          detail: "the FlowyTeam export endpoint answered without a company",
        };
      }
      return {
        ok: true,
        value: {
          companyId: String(id).trim().slice(0, 64),
          companyName: name.trim().slice(0, 400),
        },
      };
    },

    async revoke(input) {
      // RFC 7009. A FlowyTeam without the endpoint answers 404, which is a
      // refusal: waiting will not add it.
      const result = await send(
        endpoint(input.baseUrl, "/oauth/revoke"),
        form({
          token: input.accessToken,
          token_type_hint: "access_token",
          client_id: input.clientId,
          client_secret: input.clientSecret,
        }),
      );
      const failure = failed<null>(result, "the FlowyTeam revoke endpoint");
      return failure ?? { ok: true, value: null };
    },
  };
}
