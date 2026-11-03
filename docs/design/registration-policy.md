# Registration policy, set in the application

Status: approved 3 November 2026, built the same day. Q1: `zoho.com` is listed, as proposed. With nothing chosen, a claimed instance is Invitation only, the owner's stated default; an unclaimed one stays open so the setup wizard can create the first account.

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The setting | `system_settings` row `registration.policy`: `auto`, `open`, `invite_only` | Written once by the setup wizard (`invite_only` when "close registration" is ticked). Nothing writes it afterwards |
| The decision | `isRegistrationOpen()` and `registrationOpenOrInvited()` in `packages/core/src/workspaces/registration.ts`, called by Better Auth's `user.create.before` hook and by `/sign-up` | Reads the stored row only. `auto` means open until the instance is claimed, closed afterwards. A cloud instance is always open |
| The environment variable | `OPENOKR_REGISTRATION` in `.env.example`, the Helm chart and the instance registry | Documented and **never read**: setting it changes nothing |
| Trusted email domains | Admin → General, `trustedEmailDomains` per workspace | Any syntactically valid domain is accepted, `gmail.com` included |

Consequences seen in testing (local, 3 November 2026):

- On a claimed instance nobody can sign up without an invitation, so nobody can start a workspace of their own. demo.okrgoal.com is in this state.
- Opening it today means writing the row by hand in the database, with no audit row.
- An administrator can trust `gmail.com`, which would offer their workspace to every confirmed Gmail address.

## 1. What the owner asked for

1. Registration is set from Settings, not from the database.
2. A new workspace must be started with a company email address: a free mail address (Gmail, Yahoo, Outlook and the like) may not register on its own.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A **Registration** card on Admin → General, beside the instance name card | It is an instance setting, and General is where the instance name already lives |
| D2 | Three choices: **Invitation only**, **Company email addresses**, **Anyone** | "Auto" is not offered: on a claimed instance it is identical to Invitation only and reads as a fourth, mysterious state. A stored `auto` is shown as Invitation only |
| D3 | New stored value `company_domains`. No migration: the row is `jsonb` | One new string in an existing setting |
| D4 | Who may change it: a member with `full` access, the same gate as the instance name card. The action re-checks it | A server action is reachable whatever the page rendered |
| D5 | Hidden on a managed cloud (`cloud.enabled`), like the instance name card. A cloud stays open as today | On a cloud the policy is the operator's, shared by every customer |
| D6 | Every change writes an instance audit event `instance.registration_changed` with `from`, `to` and the acting member | The same chain the instance rename writes to |
| D7 | `OPENOKR_REGISTRATION` is read when no row is stored. A value saved in the application wins, and the card says where the current value comes from | The same rule as the instance name. The variable then does what its documentation says |
| D8 | One list of free mail providers in `packages/formats` (pure, shared by browser and server) | Used by both the registration check and the trusted-domain field, so the two cannot disagree |
| D9 | The trusted email domains field refuses a free mail provider | Trusting `gmail.com` would offer a workspace to strangers |
| D10 | An invitation still admits anybody, free mail included, under every policy | An invitation joins the inviting workspace; it never starts a new one |

### 2.1 The free mail list (D8)

Matched on the full domain after the `@`, lower-cased. A subdomain of a listed domain does not match (`mail.gmail.com` is not an address anybody has).

```
gmail.com googlemail.com
yahoo.com yahoo.co.id yahoo.co.uk ymail.com rocketmail.com
outlook.com hotmail.com live.com msn.com
icloud.com me.com mac.com
aol.com
proton.me protonmail.com pm.me
gmx.com gmx.net mail.com
yandex.com yandex.ru
zoho.com
```

It is a list a person keeps current, not a rule of the method, so it lives in code with a test and is not in METHOD.md.

Open question **Q1**: is `zoho.com` a free provider here? Zoho Mail has a free tier, but businesses also host custom domains on Zoho, and those addresses end in their own domain, not `zoho.com`. Proposed: listed.

## 3. The decision, per policy

| Policy | No invitation, company address | No invitation, free mail address | With a usable invitation for that address |
|---|---|---|---|
| Invitation only | Refused | Refused | Admitted, joins the inviting workspace |
| Company email addresses | Admitted, gets a workspace of their own (or the `/join` offer when a workspace trusts the domain and the address is confirmed) | Refused with "Use your company email address to start a workspace." | Admitted |
| Anyone | Admitted | Admitted | Admitted |

The refusal happens in the same `user.create.before` hook as today, so no sign-in path (email, passkey, a future social provider) can bypass it. Single sign-on callbacks stay exempt as today: the identity provider decides.

## 4. The screen

```
Registration                                                      Admin → General
Who may create an account on this instance.

( ) Invitation only
    People join through an invitation from a workspace admin.
(•) Company email addresses
    Anyone with a company address can sign up and start a workspace.
    Gmail, Yahoo, Outlook and other free mail addresses need an invitation.
( ) Anyone
    Anyone with the link can sign up and start a workspace.

Set here. (or: From OPENOKR_REGISTRATION. / The default.)
[Save]
```

The sign-up page under Company email addresses shows a line under the email field: "Use your company email address." A refused attempt shows the refusal sentence on the form, not a closed page.

## 5. Acceptance criteria

- Given a claimed instance with no stored value and no variable, when an admin opens General, then Registration shows Invitation only and "The default."
- Given an admin with `full` access, when they choose Company email addresses and save, then `registration.policy` is `company_domains` with source `admin`, and one `instance.registration_changed` audit event names them.
- Given a member below `full`, when they post the action directly, then nothing changes.
- Given Company email addresses, when `ana@acme.com` signs up with no invitation, then the account is created and gets its own workspace.
- Given Company email addresses, when `ana@gmail.com` signs up with no invitation, then no account is created and the form says "Use your company email address to start a workspace."
- Given Company email addresses and a usable invitation for `ana@gmail.com`, when she signs up through it, then she joins the inviting workspace.
- Given Invitation only, when `ana@acme.com` signs up with no invitation, then she is refused as today.
- Given no stored value and `OPENOKR_REGISTRATION=open`, when anybody signs up, then they are admitted, and General shows "From OPENOKR_REGISTRATION."
- Given `cloud.enabled`, when an admin opens General, then there is no Registration card, and sign-up stays open.
- Given the trusted email domains field, when an admin enters `gmail.com`, then saving is refused with "A free mail provider cannot be trusted: anybody can have an address there."

## 6. Tests

| Kind | File | Covers |
|---|---|---|
| Unit, pure | `packages/formats/test/free-mail.test.ts` | The list, case, subdomains |
| Integration | `packages/core/test/registration-policy.test.ts` | Each row of §3, the variable fallback, the stored `auto` |
| Integration | existing trusted-domain tests | `gmail.com` refused |
| End to end | `e2e/s35d-registration-policy.spec.ts` | Admin sets Company email addresses; a company address signs up and lands in its own workspace; a Gmail address is refused |

## 7. Documents changed in the same change

- `docs/admin/settings.md`: the `registration.policy` row, its three values and the variable.
- TECHNICAL-PLAN §4.14: the registration policy entry gains `company_domains`.
- UIUX-PLAN S-35 (sign-up line) and the General screen entry (the card).
- `.env.example` and the Helm values: `auto | open | invite_only | company_domains`.

## 8. What this change does not do

- It does not let a trusted-domain address sign up while registration is Invitation only (found in testing; a separate change).
- It does not add a filter by domain to the `/join` offer list, which today relies on row-level security alone (found in testing; a separate, small change).
- It does not let an admin create a workspace for somebody else (`workspace.provision` stays refused to members, by design).
- It does not verify that a company address is real. Without mail, an address is unconfirmed; it still only ever reaches a workspace of its own.
