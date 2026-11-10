/**
 * What an AI console write reports back (S-37, P6-G12a).
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may export nothing but async functions. The same reason
 * `admin/channels/form-state.ts` exists beside it.
 *
 * Two fields rather than a bare boolean: storing a provider key succeeds and
 * still has something worth saying, namely that the product has not called the
 * provider yet and so cannot claim the key works.
 */
export interface FormResult {
  readonly ok: boolean;
  readonly message: string;
  /**
   * Each refused field's message, shown under it (guided-inputs §4.2). The
   * message is empty when there are any.
   */
  readonly fields?: Readonly<Record<string, string>>;
}

export const NOTHING_YET: FormResult = { ok: true, message: "" };
