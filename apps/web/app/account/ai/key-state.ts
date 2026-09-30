/**
 * What a personal key write reports back (completeness review M-36).
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may export nothing but async functions. The same reason
 * `admin/ai/form-state.ts` exists.
 *
 * There is deliberately no field for the key. The answer is a sentence, and
 * the sentence never repeats what was pasted, so there is nothing in the
 * state a render could leak.
 */
export interface KeyResult {
  readonly ok: boolean;
  readonly message: string;
}

export const NOTHING_YET: KeyResult = { ok: true, message: "" };
