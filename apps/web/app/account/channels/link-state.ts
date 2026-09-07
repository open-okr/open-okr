/**
 * What a member's own channel write reports back (P5-T02c).
 *
 * Its own module because `actions.ts` carries `"use server"` and such a module
 * may only export async functions.
 *
 * `code` is the one field here that holds a secret, and it holds it for exactly
 * one render: the row stores only its hash, so there is nowhere to read it back
 * from and nothing to leak on the next load.
 */
export interface LinkResult {
  readonly ok: boolean;
  readonly code: string | null;
  readonly message: string;
}

export const NOTHING_YET: LinkResult = { ok: true, code: null, message: "" };
