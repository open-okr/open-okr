/**
 * What a token write reports back (P5-T07a).
 *
 * Its own module because `actions.ts` carries `"use server"` and such a module
 * may only export async functions.
 *
 * `token` holds a secret for exactly one render. The row stores only its digest,
 * so there is nowhere to read it back from and nothing to leak on the next load.
 */
export interface TokenResult {
  readonly ok: boolean;
  /** The raw token, once, or null. */
  readonly token: string | null;
  readonly message: string;
}

export const NOTHING_YET: TokenResult = {
  ok: true,
  token: null,
  message: "",
};
