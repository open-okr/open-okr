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
  /**
   * What authorised this, and the name says who may add.
   *
   * `demo` is the second (P8-T13a). A demo instance's cast are members before
   * they are accounts, so the command that gives them one is attaching an
   * account to a member that already exists rather than provisioning a person
   * who has just arrived. That difference matters to the join below: a
   * `directory_sync` account joins the workspace, a `demo` account is attached
   * by the caller to the member it belongs to, and joining as well would give
   * Priya two rows in the directory.
   */
  readonly kind: "directory_sync" | "demo";
  /** The workspace the arriving person belongs to. */
  readonly workspaceId: string;
  /** The identity provider's own id for them, for the audit row. */
  readonly externalId?: string;
}

/**
 * **One store for the whole process, held on `globalThis`.**
 *
 * Next bundles every route separately, so `packages/core` exists as several
 * module instances in one server and a plain module-level store is several
 * stores. The Better Auth instance is built once and cached on `globalThis`,
 * so its hooks close over whichever copy created it, while the SCIM route
 * sets the authority through its own. They never met, and the registration
 * rule refused every account SCIM tried to provision with "this instance is
 * invitation-only", which is exactly the rule the authority exists to answer.
 *
 * Found by the end-to-end spec on 17 September 2026, in the sync log's own
 * `error_message` column. The unit tests could not see it: one process, one
 * module graph, one store.
 *
 * `lib/auth.ts` caches the auth instance the same way and for the same
 * reason.
 */
const globals = globalThis as typeof globalThis & {
  openokrProvisioningAuthority?: AsyncLocalStorage<ProvisioningAuthority>;
};

if (!globals.openokrProvisioningAuthority) {
  globals.openokrProvisioningAuthority =
    new AsyncLocalStorage<ProvisioningAuthority>();
}
const storage = globals.openokrProvisioningAuthority;

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
