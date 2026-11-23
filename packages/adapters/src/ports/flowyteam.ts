/**
 * The FlowyTeam gateway port (docs/design/flowyteam-connect.md §3, §4.1).
 *
 * What this instance asks of a FlowyTeam it is connected to: exchange an
 * authorisation code, read the approving company, revoke a token. C4 adds the
 * export reads. `packages/core` declares the same shape structurally, because
 * it may not import this package.
 *
 * **Answers, not exceptions.** Every outcome a caller has to decide on comes
 * back as a value, so a refusal and an outage are never mistaken for each
 * other. Nothing here ever returns or logs a token it was given.
 */

export type FlowyteamFailure =
  | "version_mismatch"
  | "unauthorised"
  | "refused"
  | "unreachable"
  | "bad_answer";

export type FlowyteamAnswer<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly failure: FlowyteamFailure;
      readonly status?: number;
      readonly detail: string;
    };

export interface FlowyteamClientCredentials {
  readonly clientId: string;
  readonly clientSecret?: string;
}

export interface FlowyteamGateway {
  exchangeCode(
    input: FlowyteamClientCredentials & {
      readonly baseUrl: string;
      readonly code: string;
      readonly codeVerifier: string;
      readonly redirectUri: string;
    },
  ): Promise<
    FlowyteamAnswer<{ readonly accessToken: string; readonly scope: string }>
  >;
  readCompany(input: {
    readonly baseUrl: string;
    readonly accessToken: string;
    readonly version: string;
  }): Promise<
    FlowyteamAnswer<{
      readonly companyId: string;
      readonly companyName: string;
    }>
  >;
  revoke(
    input: FlowyteamClientCredentials & {
      readonly baseUrl: string;
      readonly accessToken: string;
    },
  ): Promise<FlowyteamAnswer<null>>;
}
