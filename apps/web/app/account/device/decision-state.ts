/**
 * What a device decision reports back (P5-T07c-b).
 *
 * Its own module because `actions.ts` carries `"use server"` and such a module
 * may only export async functions.
 *
 * This is the one form on the account screens whose success message matters and
 * has nowhere else to live: once the request is decided the row is gone from the
 * pending read, so the page cannot render the outcome from server state the way
 * the channel and token screens do.
 */
export interface DecisionResult {
  readonly ok: boolean;
  readonly decided: boolean;
  readonly approved: boolean;
  readonly message: string;
}

export const NOTHING_YET: DecisionResult = {
  ok: true,
  decided: false,
  approved: false,
  message: "",
};
