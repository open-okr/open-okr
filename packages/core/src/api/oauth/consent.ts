/**
 * What the consent screen asks and what approving it does (screen S-40,
 * P5-T08c).
 *
 * **Everything a client asked for is validated before a person is shown
 * anything.** An unknown client, an unregistered redirect, a missing challenge:
 * all of them are refused at the point the browser arrives, not after somebody
 * has read a page and pressed approve. A screen that asks "do you allow this?"
 * about a request the server was always going to refuse wastes the one thing a
 * person brought to it, which is their attention.
 *
 * **Where a refusal goes depends on whether the redirect is trustworthy.** RFC
 * 6749 §4.1.2.1 draws the line and it is the right one: an error about the
 * client's identity or its redirect must be shown to the person, because
 * bouncing it to an address that failed validation is handing an error, and the
 * request's state, to whoever supplied that address. Everything else goes back
 * to the client, which is what lets an agent report a refusal properly.
 *
 * **What is granted is what was asked for, narrowed.** There is no control for
 * widening scopes, because a form field that could widen a request is a path by
 * which a grant becomes wider than the request. Asking for less means asking
 * again.
 */
import {
  activeOnly,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { resolveClient } from "./clients.ts";
import { SUPPORTED_SCOPES } from "./discovery.ts";
import { issueAuthorisationCode } from "./flow.ts";
import { createGrant } from "./grants.ts";
import { CHALLENGE_METHOD } from "./pkce.ts";

/** What arrives on the authorise endpoint, before anything is trusted. */
export interface AuthoriseRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly responseType: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly scope: string;
  readonly state: string;
  /** RFC 8707. Absent means "this instance", which is the only answer anyway. */
  readonly resource: string;
}

export type AuthoriseRefusal =
  /** Shown to the person: the redirect cannot be trusted with an error. */
  | { readonly kind: "show"; readonly message: string }
  /** Sent back to the client, which is what lets an agent report it. */
  | {
      readonly kind: "redirect";
      readonly error: string;
      readonly description: string;
    };

export type AuthoriseCheck =
  | {
      readonly kind: "ok";
      readonly clientRowId: string;
      readonly clientName: string;
      readonly scopes: readonly string[];
    }
  | { readonly kind: "refused"; readonly refusal: AuthoriseRefusal };

/**
 * The scopes a request asks for, narrowed to ones this server issues.
 *
 * An unknown scope is dropped rather than refused: RFC 6749 §3.3 allows a
 * server to issue less than was asked for, and a client that asks for something
 * this instance has never heard of is usually a client written against a newer
 * version. Asking for nothing at all means read, which is the least a
 * connection can usefully have.
 */
export function scopesFrom(scope: string): readonly string[] {
  const asked = scope
    .split(/[\s+]+/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const granted = asked.filter((value) =>
    (SUPPORTED_SCOPES as readonly string[]).includes(value),
  );
  return granted.length > 0 ? granted : ["read"];
}

/**
 * Whether this request may be shown to a person at all.
 *
 * Runs before the screen renders. The client lookup materialises an allow-listed
 * client on first use, which is why it needs a transaction.
 */
export async function checkAuthoriseRequest(
  tx: WorkspaceTx,
  input: {
    readonly request: AuthoriseRequest;
    readonly issuer: string;
  },
): Promise<AuthoriseCheck> {
  const { request } = input;

  if (request.clientId.trim() === "") {
    return {
      kind: "refused",
      refusal: { kind: "show", message: "That request names no client." },
    };
  }
  if (request.redirectUri.trim() === "") {
    return {
      kind: "refused",
      refusal: {
        kind: "show",
        message: "That request names no address to answer at.",
      },
    };
  }

  // The client and its redirect first, because everything after this is only
  // safe to report *to* the redirect once the redirect is known to be its own.
  const client = await resolveClient(tx, {
    clientId: request.clientId,
    redirectUri: request.redirectUri,
  });
  if (client.kind === "rejected") {
    return {
      kind: "refused",
      refusal: {
        kind: "show",
        message:
          client.reason === "unknown_client"
            ? "This instance does not know that client. It can register itself and try again."
            : "That client asked to be answered at an address it has not registered.",
      },
    };
  }

  // From here the redirect is the client's own, so a refusal may travel to it.
  if (request.responseType !== "code") {
    return {
      kind: "refused",
      refusal: {
        kind: "redirect",
        error: "unsupported_response_type",
        description: "This server issues authorisation codes only.",
      },
    };
  }
  if (request.codeChallenge.trim() === "") {
    return {
      kind: "refused",
      refusal: {
        kind: "redirect",
        error: "invalid_request",
        // Not optional here. Every client is public, so without it a stolen
        // code is worth as much as the client's whole session.
        description: "A code_challenge is required.",
      },
    };
  }
  if (request.codeChallengeMethod !== CHALLENGE_METHOD) {
    return {
      kind: "refused",
      refusal: {
        kind: "redirect",
        error: "invalid_request",
        description: `This server accepts ${CHALLENGE_METHOD} only.`,
      },
    };
  }
  if (
    request.resource.trim() !== "" &&
    request.resource.replace(/\/+$/, "") !== input.issuer.replace(/\/+$/, "")
  ) {
    return {
      kind: "refused",
      refusal: {
        kind: "redirect",
        error: "invalid_target",
        description: "That resource is not this instance.",
      },
    };
  }

  return {
    kind: "ok",
    clientRowId: client.client.id,
    clientName: client.client.name,
    scopes: scopesFrom(request.scope),
  };
}

/**
 * Records the grant and issues the code, in one transaction.
 *
 * One transaction because a grant with no code is a connection somebody thinks
 * they made and a code with no grant is a code that resolves to nothing. Both
 * are states a person would have to be told about, and neither needs to exist.
 */
export async function approveAuthorisation(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly clientRowId: string;
    readonly scopes: readonly string[];
    readonly redirectUri: string;
    readonly challenge: string;
    readonly challengeMethod: string;
    readonly resource: string;
    readonly now: Date;
  },
): Promise<{ readonly grantId: string; readonly code: string }> {
  const grantId = await createGrant(tx, {
    workspaceId: input.workspaceId,
    memberId: input.memberId,
    clientId: input.clientRowId,
    scopes: input.scopes,
    resource: input.resource,
    now: input.now,
  });

  const code = await issueAuthorisationCode(tx, {
    workspaceId: input.workspaceId,
    grantId,
    challenge: input.challenge,
    challengeMethod: input.challengeMethod,
    redirectUri: input.redirectUri,
    resource: input.resource,
    now: input.now,
  });

  return { grantId, code };
}

/**
 * The address to send a browser to after a decision.
 *
 * `state` is echoed exactly as it arrived and is never interpreted: it is the
 * client's own value, and its whole purpose is that the client recognises it.
 */
export function redirectWith(
  redirectUri: string,
  params: Readonly<Record<string, string>>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** What each scope means, in words somebody deciding can actually weigh. */
export const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  read: "Read anything you can read",
  write: "Create and change things you can change",
  destructive: "Delete and archive things you can delete",
};

export type ApprovalOutcome =
  | { readonly kind: "issued"; readonly code: string; readonly grantId: string }
  | { readonly kind: "refused"; readonly description: string };

/**
 * Approving, with the transaction and the member lookup this needs (P5-T08c).
 *
 * **The whole request is validated again here, not just trusted from the form.**
 * The screen validated it to decide what to show; this validates it to decide
 * what to grant. They are a page load apart, the fields in between travelled
 * through a browser, and a client can be revoked or a redirect edited in that
 * gap. Re-running the check is a few queries and removes the whole class.
 *
 * **The member is resolved from the session's user, never from the form.** A
 * form that named a member would be a form somebody could point at a colleague.
 */
export async function approveAuthorisationForMember(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly challenge: string;
    readonly challengeMethod: string;
    readonly scope: string;
    readonly resource: string;
    readonly issuer: string;
    readonly now: Date;
  },
): Promise<ApprovalOutcome> {
  return withWorkspace(drizzle(pool), input.workspaceId, async (tx) => {
    const check = await checkAuthoriseRequest(tx, {
      request: {
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        responseType: "code",
        codeChallenge: input.challenge,
        codeChallengeMethod: input.challengeMethod,
        scope: input.scope,
        state: "",
        resource: input.resource,
      },
      issuer: input.issuer,
    });

    if (check.kind === "refused") {
      return {
        kind: "refused",
        description:
          check.refusal.kind === "show"
            ? check.refusal.message
            : check.refusal.description,
      } as const;
    }

    const [member] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
          eq(workspaceMembers.status, "active"),
        ),
      )
      .limit(1);

    if (!member) {
      return {
        kind: "refused",
        description: "You are not an active member of that workspace.",
      } as const;
    }

    const issued = await approveAuthorisation(tx, {
      workspaceId: input.workspaceId,
      memberId: member.id,
      clientRowId: check.clientRowId,
      scopes: check.scopes,
      redirectUri: input.redirectUri,
      challenge: input.challenge,
      challengeMethod: input.challengeMethod,
      // Always this instance. The check above already refused any other.
      resource: input.issuer.replace(/\/+$/, ""),
      now: input.now,
    });

    return {
      kind: "issued",
      code: issued.code,
      grantId: issued.grantId,
    } as const;
  });
}

/**
 * The same check, with the transaction the screen cannot open (P5-T08c).
 *
 * `apps/web` may not reach for a database client, so the two-line wrapper lives
 * here beside the check it wraps.
 */
export async function checkAuthoriseRequestFor(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    readonly request: AuthoriseRequest;
    readonly issuer: string;
  },
): Promise<AuthoriseCheck> {
  return withWorkspace(drizzle(pool), input.workspaceId, (tx) =>
    checkAuthoriseRequest(tx, {
      request: input.request,
      issuer: input.issuer,
    }),
  );
}
