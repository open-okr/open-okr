/**
 * A token's scopes are a ceiling for every action it causes
 * (docs/design/token-scope-ceiling.md, approved 10 November 2026).
 *
 * REST and the agent endpoint check a token's scopes against the action it
 * names. Four actions run another action inside themselves on the caller's
 * behalf (`proposals.apply`, `proposals.bulkApply`, `copilot.applyProposal`
 * and `alignment.applyFinding`), and before this a `write` token could apply a
 * proposal whose action was destructive.
 *
 * **The ceiling travels with the call, not with the context object** (C1).
 * Each of those four builds its own context for the nested call, so a rule
 * that depended on copying a field would be a rule the fifth one forgets. An
 * `AsyncLocalStorage` holds the scopes for everything the call starts, the
 * way the dry run (D4) is carried. One store per process, for the reason
 * `provisioning-authority.ts` keeps one: Next can load this module twice.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Scope = "read" | "write" | "destructive";

const globals = globalThis as typeof globalThis & {
  openokrScopeCeiling?: AsyncLocalStorage<readonly string[]>;
};
globals.openokrScopeCeiling ??= new AsyncLocalStorage<readonly string[]>();
const ceilings = globals.openokrScopeCeiling;

/** The scopes in force for this call, or undefined where no token is. */
export function currentCeiling(): readonly string[] | undefined {
  return ceilings.getStore();
}

/** Runs `fn` with these scopes as the ceiling for everything it calls. */
export function withCeiling<T>(
  scopes: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  return ceilings.run(scopes, fn);
}

/**
 * An action the ceiling does not reach (C4): answered `insufficient_scope`,
 * naming the action and the scope it needs, so a person can mint the token
 * that would have done it.
 */
export class ScopeCeilingRefused extends Error {
  readonly action: string;
  readonly needs: Scope;
  readonly has: readonly string[];
  constructor(action: string, needs: Scope, has: readonly string[]) {
    super(
      `This runs ${action}, which needs the ${needs} scope. This token has: ${has.join(", ") || "none"}.`,
    );
    this.name = "ScopeCeilingRefused";
    this.action = action;
    this.needs = needs;
    this.has = has;
  }
}
