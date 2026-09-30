/**
 * Who is calling the agent endpoint (AI-NATIVE-PLAN.md §8.1, completeness
 * review M-12).
 *
 * **Two ways in, and one principal out.** A hosted agent arrives with an OAuth
 * access token, minted after a person approved it on the consent screen. A
 * local agent that cannot open a browser, such as a coding agent or a desktop
 * assistant configured from a file, arrives with an agent token instead: an API
 * token the member minted for the `mcp` audience on their own tokens screen.
 * §8.1 names both: OAuth for the HTTP transport, and "scoped tokens remain for
 * local and scripted use".
 *
 * **The audiences stay apart.** A REST token presented here is refused, and an
 * agent token presented at the REST surface is refused there. That is read from
 * the stored row, not from the token's text, so a caller cannot talk its way
 * through a door by renaming its token. The prefix only chooses which table to
 * look in, and a lookup in the wrong table finds nothing.
 *
 * **Both carry the same authority.** One member in one workspace, narrowed by
 * `read`, `write` and `destructive`, the same three words for both. Scope is
 * checked before a tool runs and `can()` runs inside it, exactly as for a
 * grant, so an agent token is never a wider door than the consent screen.
 * Membership and suspension are read on every request for both.
 */
import type { Pool } from "pg";
import { type AccessRejection, resolveAccessToken } from "../oauth/resolve.ts";
import {
  audienceFromText,
  resolveApiToken,
  stampTokenUse,
  type TokenRejection,
} from "../tokens.ts";

interface PrincipalBase {
  readonly kind: "ok";
  readonly workspaceId: string;
  readonly memberId: string;
  /** The global user the actor is. A token is never its own principal. */
  readonly userId: string;
  readonly scopes: readonly string[];
}

/** A hosted agent, holding what a person approved on the consent screen. */
export interface GrantPrincipal extends PrincipalBase {
  readonly via: "grant";
  readonly grantId: string;
}

/** A local agent, holding a token its member minted for the agent endpoint. */
export interface AgentTokenPrincipal extends PrincipalBase {
  readonly via: "token";
  readonly tokenId: string;
}

export type AgentRejection = AccessRejection | TokenRejection;

export type AgentPrincipal =
  | GrantPrincipal
  | AgentTokenPrincipal
  | { readonly kind: "rejected"; readonly reason: AgentRejection };

/**
 * Turns whatever bearer arrived at the agent endpoint into a principal.
 *
 * An API token, of either audience, is resolved as one and must be for `mcp`.
 * Anything else is resolved as an OAuth access token, which refuses every
 * string that is not one. Neither path can succeed with the other's secret.
 */
export async function resolveAgentPrincipal(
  pool: Pool,
  input: {
    readonly raw: string;
    /** The protected resource a grant must be bound to. */
    readonly resource: string;
    readonly now: Date;
  },
): Promise<AgentPrincipal> {
  if (audienceFromText(input.raw) !== null) {
    const resolved = await resolveApiToken(pool, {
      raw: input.raw,
      audience: "mcp",
      now: input.now,
    });
    if (resolved.kind === "rejected") {
      return resolved;
    }
    // The same stamp the REST surface leaves, so the tokens screen can say
    // which of somebody's tokens is still in an agent's configuration.
    await stampTokenUse(pool, {
      workspaceId: resolved.workspaceId,
      tokenId: resolved.tokenId,
      now: input.now,
    });
    return {
      kind: "ok",
      via: "token",
      tokenId: resolved.tokenId,
      workspaceId: resolved.workspaceId,
      memberId: resolved.memberId,
      userId: resolved.userId,
      scopes: resolved.scopes,
    };
  }

  const resolved = await resolveAccessToken(pool, input);
  if (resolved.kind === "rejected") {
    return resolved;
  }
  return {
    kind: "ok",
    via: "grant",
    grantId: resolved.grantId,
    workspaceId: resolved.workspaceId,
    memberId: resolved.memberId,
    userId: resolved.userId,
    scopes: resolved.scopes,
  };
}

/**
 * The key one principal's rate limit is counted under.
 *
 * Per grant rather than per access token, because an access token lives an hour
 * and is replaced on refresh, and a limit that reset on every refresh would
 * limit nothing. Per agent token rather than per member, for the reason the
 * REST surface gives: two agents sharing one person's authority should not be
 * able to starve each other by accident.
 */
export function agentRateKey(
  principal: GrantPrincipal | AgentTokenPrincipal,
): string {
  return principal.via === "grant"
    ? `mcp:grant:${principal.grantId}`
    : `mcp:token:${principal.tokenId}`;
}
