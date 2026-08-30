/**
 * What a revoke reports back (P5-T08c).
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may only export async functions.
 */
export interface RevokeResult {
  readonly ok: boolean;
  readonly message: string;
}

export const NOTHING_YET: RevokeResult = { ok: true, message: "" };
