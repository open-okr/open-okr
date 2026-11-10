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
| Company email addresses | Admitted, gets a workspace of their own (or the `/join` offer when a workspace trusts the domain and the address is confirmed) | Refused with "Use your company email address to start a workspace. A Gmail, Yahoo, Outlook or other free mail address needs an invitation from a workspace admin." | Admitted |
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

Set here. (or: From the deployment's environment variable. A choice saved
here overrides it. / The default: open until somebody claims the instance,
invitation only after that.)
[Save]
```

The sign-up page under Company email addresses shows a line under the email field: "Use your company email address. A free mail address needs an invitation." A refused attempt shows the refusal sentence on the form, not a closed page.

## 5. Acceptance criteria

- Given a claimed instance with no stored value and no variable, when an admin opens General, then Registration shows Invitation only and "The default: open until somebody claims the instance, invitation only after that."
- Given an admin with `full` access, when they choose Company email addresses and save, then `registration.policy` is `company_domains` with source `admin`, and one `instance.registration_changed` audit event names them.
- Given a member below `full`, when they post the action directly, then nothing changes.
- Given Company email addresses, when `ana@acme.com` signs up with no invitation, then the account is created and gets its own workspace.
- Given Company email addresses, when `ana@gmail.com` signs up with no invitation, then no account is created and the form says "Use your company email address to start a workspace. A Gmail, Yahoo, Outlook or other free mail address needs an invitation from a workspace admin."
- Given Company email addresses and a usable invitation for `ana@gmail.com`, when she signs up through it, then she joins the inviting workspace.
- Given Invitation only, when `ana@acme.com` signs up with no invitation, then she is refused as today.
- Given no stored value and `OPENOKR_REGISTRATION=open`, when anybody signs up, then they are admitted, and General shows "From the deployment's environment variable. A choice saved here overrides it."
- Given `cloud.enabled`, when an admin opens General, then there is no Registration card, and sign-up stays open.
- Given the trusted email domains field, when an admin enters `gmail.com`, then saving is refused with "gmail.com is a free mail provider and cannot be trusted: anybody can have an address there."

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

## 9. The wizard's saved policy, and registration on a cloud (release 0.7.0, B1)

Status: Approved by Akmal on 9 November 2026 ("design approved"). Q2: D16 as written; a stored `invite_only` from the wizard is kept, and the upgrade notes tell operators to check the card.

### 9.1 What is wrong

| Where | What happens |
|---|---|
| `apps/web/app/setup/account/actions.ts:96` | Finishing the wizard always passes `closeRegistration: true` |
| `packages/core/src/setup/complete.ts:82-86` | That saves `registration.policy = invite_only`, source `wizard` |
| `policyInForce` in `registration.ts` | A saved row beats `OPENOKR_REGISTRATION` and beats the cloud's open default (D7, D5) |

Two consequences, one cause:

1. **A cloud closes behind its first account.** Setups 1 and 2 (OKRGoal, a provider's own cloud) expect anyone to sign up and start a workspace. After the wizard, nobody can. The Registration card is hidden on a cloud (D5), so no screen can reopen it, and no operator screen has a control either.
2. **On a self-hosted instance the variable stops working after setup.** An instance deployed with `OPENOKR_REGISTRATION=company_domains` takes company addresses until the wizard finishes, then silently becomes invitation only. D7 promises the variable holds until somebody saves a choice on General.

The write is also redundant. Since P1-T09 the computed default already says "open until claimed, invitation only after", so a self-hosted instance with nothing saved closes behind its first account without any row.

### 9.2 Decisions

| # | Decision | Why |
|---|---|---|
| D11 | **The wizard writes no registration policy, on any instance.** `closeRegistration` is removed from `completeSetup` and its caller | The computed default closes a self-hosted instance after the claim, the cloud default keeps a cloud open, and the variable keeps working on both. One rule instead of a row that overrides it |
| D12 | **A Registration card on the operator's instance screen (S-47)**, shown only on a cloud. The same three choices as D2, and the same source line as §4 | On a cloud the policy is the operator's (D5). Today nothing can set it but the database |
| D13 | Only a cloud operator may change it there, re-checked in the server action with `requireOperator`, as the site message form does | An operator action, not a member's |
| D14 | Saved with source `operator`. `system_settings.source` is plain text (migration 0007), so **no migration** | Says who chose it, without a new column |
| D15 | Every change writes `instance.registration_changed` to the instance audit chain with `from`, `to` and `operatorUserId`. No workspace row: the policy belongs to no workspace | The operator console's own rule (`operator-console.md` §6), minus the workspace half, which has no workspace |
| D16 | **A row the wizard saved before this release is left alone.** No data change rewrites it. On a cloud the operator changes it from D12; on a self-hosted instance an admin changes it on General as today | The plan's recommendation: nothing stored is rewritten by an upgrade. See Q2 for the alternative |

**Q2, for you.** D16 leaves every existing cloud closed until its operator opens it from the new card, and every existing self-hosted instance still ignoring its variable. The alternative is to read a row whose source is `wizard` as "not chosen", so existing clouds reopen and existing variables start working on upgrade, with no row rewritten. That is the documented behaviour, but it changes who can sign up on an instance the moment it upgrades, without anybody choosing it. **Proposed: D16 as written, and the upgrade notes tell an operator to check the card.**

### 9.3 The card on S-47

```
Registration                                          Operator → Instance
Who may create an account on this cloud.

( ) Invitation only
(•) Company email addresses
( ) Anyone

The default: open on a cloud. (or: Chosen by an operator. / Saved by the setup
wizard before 0.7.0. / From the deployment's environment variable.)
[Save]
```

### 9.4 Acceptance criteria

- Given a fresh self-hosted instance, when the wizard finishes, then no `registration.policy` row exists and a second sign-up with no invitation is refused.
- Given a fresh self-hosted instance with `OPENOKR_REGISTRATION=company_domains`, when the wizard finishes and `ana@acme.com` signs up with no invitation, then she is admitted with a workspace of her own.
- Given a fresh cloud instance, when the wizard finishes and a stranger signs up, then they are admitted.
- Given a cloud with a stored `invite_only` from the wizard, when an operator chooses Anyone on S-47 and saves, then the row is `open` with source `operator`, one `instance.registration_changed` instance audit event names the operator, and a stranger can sign up.
- Given a signed-in member who is not an operator, when they post the S-47 registration action, then nothing changes.
- Given a self-hosted instance, when an operator opens S-47, then there is no Registration card (S-47 is cloud only, `operator-console.md` §7).

### 9.5 Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/setup-complete.test.ts` (existing or new) | The wizard writes no policy |
| Integration | `packages/core/test/registration-policy.test.ts` | The variable after a claim; the operator save, its source and its audit event |
| Unit | `apps/web/test/operator-registration.test.ts` | The action refuses a non-operator and posts the choice |
| End to end | `e2e/s47-operator-instance.spec.ts` (extend) | The card saves and the source line changes |

### 9.6 Documents changed in the same change

- `docs/install/setups.md` and `docs/install/cloud.md`: who opens registration on a cloud, and where.
- `docs/admin/settings.md`: the `registration.policy` row says the wizard no longer saves it.
- UIUX-PLAN S-47: the card.
- The upgrade notes for 0.7.0: an existing cloud keeps the wizard's `invite_only` until its operator changes it.
