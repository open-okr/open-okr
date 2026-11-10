/**
 * What a webhook write reports back (docs/design/outbound-webhooks.md §3).
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may only export async functions.
 *
 * `secret` is set by a create and a rotation and by nothing else, and the
 * screen shows it from this answer alone: there is no other place it could be
 * read back from, because the table holds it sealed.
 */
export interface WebhookResult {
  readonly ok: boolean;
  readonly message: string;
  readonly secret?: string;
  /** Input path to message, for the kit fields under `RefusedFields`. */
  readonly fields?: Readonly<Record<string, string>>;
}

export const NOTHING_YET: WebhookResult = { ok: true, message: "" };
