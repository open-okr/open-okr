# Single sign-on: which accounts a connection may touch

Status: design approved 2026-11-09. Ships in 0.6.1.

A single sign-on connection belongs to one workspace. Until now two of its effects reached past that workspace: an OIDC sign-in could attach itself to an existing account by email, and an enforcing connection refused local sign-in for every account on its domains. This document scopes both to the members of the connection's workspace.

## Rules

| # | Rule | Where |
|---|---|---|
| 1 | An SSO sign-in may attach to an existing account only when that account is an active or invited member of the connection's workspace | `account.create.before` hook in `packages/core/src/auth/auth.ts` |
| 2 | An SSO sign-in that registers a new account is unchanged: the account is created and joins the connection's workspace | Existing `user.create.after` hook |
| 3 | "New account" means: no other sign-in method on the account and no membership in any workspace | Same hook as rule 1 |
| 4 | Enforcement refuses a local sign-in (password, reset, passkey, one-time code) only for an account that is an active member of the enforcing connection's workspace | `packages/core/src/auth/sso-enforcement.ts` |
| 5 | Enforcement no longer refuses a sign-up. An address with no account is nobody's member yet | Same |
| 6 | SAML keeps its current behaviour: the plugin does not trust the provider's email verification, so it never attaches to an existing account implicitly. Rule 1 applies to it as well, as a backstop | Same hook as rule 1 |

A refused attach answers with the existing "account not linked" path, which sends the browser to the sign-in error page. No new message text is needed.

## What changes for an organisation

| Situation | Before | After |
|---|---|---|
| Member of workspace A signs in through A's provider for the first time, already has a password | Attached | Attached |
| Person with no account signs in through A's provider | Account created, joins A | Same |
| Account that is not a member of A signs in through A's provider with the same email | Attached | Refused |
| Member of A with A enforcing their domain tries a password | Refused | Refused |
| Account on an enforced domain that is not a member of A tries a password | Refused | Allowed |
| New person signs up with a password on an enforced domain | Refused | Allowed. Once they join A, password sign-in is refused from then on |

The last row is the cost. A company that wants new staff to arrive through its provider sends invitations, and the provider sign-in then joins them. Domain proof (DNS TXT, decision 7 of the 2026-11-08 review) is the 0.6.1 follow-up that restores refusal at sign-up for a proven domain.

## Acceptance criteria

- Given an account with a password that is not a member of workspace A, When an OIDC sign-in through A's connection asserts its email as verified, Then no account row is linked and no session is created.
- Given an active member of workspace A with a password, When an OIDC sign-in through A's connection asserts the same email, Then the provider account is linked and a session is created.
- Given an address with no account, When an OIDC sign-in through A's connection completes, Then an account is created and it is a member of A.
- Given workspace A enforces `example.com`, When an account on `example.com` that is not a member of A signs in with a password, Then the sign-in succeeds.
- Given workspace A enforces `example.com`, When an active member of A on `example.com` signs in with a password or a passkey, Then the sign-in is refused with the existing enforcement message.
- Given workspace A enforces `example.com`, When a new person signs up with `new@example.com`, Then the sign-up succeeds.

## Not in this change

- Domain proof by DNS TXT and refusing a domain another workspace already proved.
- Any change to the SSO admin screen.
- A migration. Membership is read with the existing `withUser` context, which answers "which workspaces are mine" and nothing else.
