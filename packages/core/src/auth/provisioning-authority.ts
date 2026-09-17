/**
 * What authorised an account to be created outside a sign-up (P8-T08a).
 *
 * Registration on a closed instance is refused inside Better Auth, in the
 * `user.create.before` hook, and P1-T06 chose that deliberately: refusing at
 * the route would leave every future path free to reopen registration by not
 * knowing the rule. An invitation is the exception, and it reaches that hook
 * through a cookie the browser carries.
 *
 * A directory has no browser and no cookie. A SCIM request carries a bearer
 * token the workspace issued, which is an authorisation to provision people,
 * and without a way to say so the hook refuses every SCIM account on exactly
 * the instances that run a directory: the invitation-only ones.
 *
 * So the authority is carried the only way a server-side call can carry it,
 * in the async context of the call itself. It is set by the code that has
 * already verified the token and read by the hook. It never comes from a
 * request, cannot be set by anything a caller sends, and is gone as soon as
 * the call it wraps returns.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface ProvisioningAuthority {
  /** What authorised this. One value today, and the name says who may add. */
  readonly kind: "directory_sync";
  /** The workspace the arriving person belongs to. */
  readonly workspaceId: string;
  /** The identity provider's own id for them, for the audit row. */
  readonly externalId?: string;
}

const storage = new AsyncLocalStorage<ProvisioningAuthority>();

/** Runs `fn` with this authority in scope. */
export function withProvisioningAuthority<T>(
  authority: ProvisioningAuthority,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(authority, fn);
}

/** The authority in scope, if the caller established one. */
export function currentProvisioningAuthority():
  | ProvisioningAuthority
  | undefined {
  return storage.getStore();
}
