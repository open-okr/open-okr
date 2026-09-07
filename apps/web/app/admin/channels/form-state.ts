/**
 * What a channel settings write reports back (P5-T02c).
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may only export async functions. The shared shape therefore
 * cannot live where it is produced.
 *
 * Two fields rather than one: connecting succeeds *and* has something worth
 * saying, namely that storing a credential is not the same as proving it works.
 */
export interface FormResult {
  readonly ok: boolean;
  readonly message: string;
}

export const NOTHING_YET: FormResult = { ok: true, message: "" };
