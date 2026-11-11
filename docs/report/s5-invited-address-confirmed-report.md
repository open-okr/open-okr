# S5: an invited address arrives confirmed, verification report

Plan 0.8.0 row S5, design `docs/design/email-verification.md` §12. This checks Akmal's build, `416eb66c`, as it stands on `release-0.8.0` at `6d136566`. It answers question Q-3 of `uat-0.8.0-report.md`, where an invited person was asked to confirm the address their invitation had reached.

A second build of S5 was made in parallel on `feat/s5-invited-address-confirmed`. It was dropped on 11 November 2026 so the two would not conflict, and the branch is deleted. Its one difference is the finding below.

## How it was checked

Playwright MCP, Chromium at 1440x900, on a Docker image built from `6d136566`. The instance requires confirmation (SMTP to a local MailHog), is invitation only, and runs with the cloud flag on. Screenshots are kept outside the repository with the UAT run.

## Results

| # | Scenario | Result |
|---|---|---|
| A | Personal invitation to `qa+ak5one@example.com`, sign-up typed as `QA+Ak5one@Example.com` | Pass. Welcome card ("Your account has been created. You can use it right away."); Get started goes into the inviting workspace, one membership and no workspace of their own; `email_verified` true; `auth.email_verified {via: "invitation"}`; the only mail sent was the invitation |
| B | Shared workspace link, `qa+ak5shared@example.com` | Pass. Check-your-email card; not confirmed; the confirmation mail was sent |
| C | Personal invitation to `qa+ak5two@example.com`, sign-up as `qa+ak5wrong@example.com` | Pass. Refused: "This instance is invitation-only. Ask a workspace admin to invite you." |
| D | S5-Q2 on the join page: `qa+ak5q2@example.com` signed up through the shared link while confirmation was off, so signed in and unconfirmed, then accepted a personal invitation to its own address with Join | Pass. Confirmed; `auth.email_verified {via: "invitation"}` |
| E | S5-Q2 through the REST surface: the same set-up for `qa+ak5rest@example.com`, then `POST /api/v1/invitations/acceptLink` with the person's own API token | **Gap.** The call answered 200 and the person joined, but the account stayed unconfirmed. The invitation is single use and is now spent, so the join page can no longer confirm it either; the person confirms through the ordinary mail link |

## Finding

| Severity | What | Where | Suggested change |
|---|---|---|---|
| Can wait | S5-Q2 confirms only on the join page. Accepting a personal invitation through REST, the command line or an agent, all projections of `invitations.acceptLink`, joins the workspace and uses the invitation up without confirming the address | `apps/web/app/join/[token]/actions.ts` confirms after the action returns, so only the browser path does | Confirm inside `invitations.acceptLink` itself, in its transaction, and carry the instance chain's `auth.email_verified` row as an outbox row, since an Operation's transaction cannot write the instance chain. Akmal's decision; the design's §12.5 said "the same proof", without naming a path |

Nobody loses access through it: the account works, and the confirmation mail still confirms it. What is lost is the one-step confirmation S5-Q2 promised, for people who accept outside a browser.

## Other checks

- Signing up with the invited address in different case (`QA+Ak5one@Example.com`) matched, as §12.1 says (lower-cased).
- On scenario A the confirmation mail was not sent at all, so nobody receives a link for an address that is already confirmed.
- Email confirmation was switched off and back to Automatic from the operator console for scenarios D and E, and left on Automatic.
