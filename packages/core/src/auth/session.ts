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
