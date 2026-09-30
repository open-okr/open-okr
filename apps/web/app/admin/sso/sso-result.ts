/**
 * What a single sign-on write reports back to the screen.
 *
 * Its own module because `actions.ts` carries `"use server"`, and a server
 * action module may export nothing but async functions. The same reason
 * `admin/ai/form-state.ts` exists beside its actions.
 *
 * `field` names the input the refusal is about, so the edit form puts the
 * message under that field, exactly as the add form does with the answer
 * from `POST /api/v1/admin/sso`.
 */
export type SSOWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string; readonly field?: string };

/** What the edit form sends. Blank text clears an optional field. */
export interface SSOEditInput {
  readonly id: string;
  readonly kind: "oidc" | "saml";
  readonly displayName: string;
  readonly emailDomains: string;
  readonly enforce: boolean;
  readonly clientId?: string;
  /** Blank keeps the stored secret. */
  readonly clientSecret?: string;
  readonly discoveryUrl?: string;
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly userInfoUrl?: string;
  readonly scopes?: string;
  readonly samlEntryPoint?: string;
  readonly samlIssuer?: string;
  readonly samlCertificate?: string;
  readonly samlAudience?: string;
}
