/**
 * Reading the current session on the server.
 *
 * One place resolves "who is asking", so a route or a page never parses a
 * cookie itself. Returning null rather than throwing keeps the caller honest
 * about the signed-out case, which is a normal state, not an error.
 */
import type { Auth } from "./auth.ts";

export interface CurrentSession {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly emailVerified: boolean;
    readonly twoFactorEnabled: boolean | null | undefined;
  };
  readonly session: { readonly id: string; readonly expiresAt: Date };
}

/**
 * The signed-in user for a request, or null. The headers are passed in
 * rather than read from a framework global, so this works identically in a
 * route handler, a server component and a test.
 */
export async function getCurrentSession(
  auth: Auth,
  headers: Headers,
): Promise<CurrentSession | null> {
  const result = await auth.api.getSession({ headers });
  return (result as CurrentSession | null) ?? null;
}

/** One live session of one user, as the security screen lists it. */
export interface UserSession {
  /** The row's own identifier. Safe to render, and stable. */
  readonly id: string;
  /** What `revokeSession` takes. The stored value, which is a digest. */
  readonly token: string;
  readonly createdAt: Date;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}

/**
 * Every live session of one user, newest first.
 *
 * Better Auth's `/list-sessions` endpoint is not used, deliberately. It is
 * gated on session freshness, which defaults to one day, while a session here
 * lives for thirty (`createAuth`). Reading the list through the endpoint
 * therefore answers 403 for twenty-nine days out of thirty, which is what
 * made the security screen fail rather than render.
 *
 * Raising `freshAge` is the wrong lever: the same number decides whether
 * deleting an account still demands the password. So this reads through
 * Better Auth's own adapter instead, which keeps the token hashing wrapper
 * and leaves freshness guarding the endpoints that change something.
 *
 * That the list is unauthenticated here is the caller's business: pass the
 * identifier of the user who is asking, never one taken from a request.
 */
export async function listUserSessions(
  auth: Auth,
  userId: string,
): Promise<UserSession[]> {
  const context = await auth.$context;
  const sessions = await context.internalAdapter.listSessions(userId, {
    onlyActiveSessions: true,
  });

  return sessions
    .map((session) => ({
      id: session.id,
      token: session.token,
      createdAt: new Date(session.createdAt),
      userAgent: session.userAgent ?? null,
      ipAddress: session.ipAddress ?? null,
    }))
    .sort(
      (first, second) => second.createdAt.getTime() - first.createdAt.getTime(),
    );
}
