# Your account: password, sign-in email, name, and the endpoints nobody uses

Status: **approved by Akmal on 11 November 2026**, AS-Q1 to AS-Q8 as recommended, and Y6's endpoint switch-off to land first, as its own commit. Plan 0.8.0 rows Y3, Y4, Y5 and Y6 (`docs/plans/release-0.8.0.md` §2). Gate: design first, because all four touch authentication or access, and Y4 changes stored user data (CLAUDE.md).

**No migration**, unless AS-Q3 chooses option (b). No new table, no new setting, no new runtime dependency. Every Better Auth import named here comes from `better-auth` itself (`better-auth/api`, `better-auth/crypto`), which `packages/core` already depends on.

Better Auth paths below are in the installed 1.7.18. `better-auth` means `node_modules/better-auth/dist`, `core` means `node_modules/@better-auth/core/dist`, `sso` means `node_modules/@better-auth/sso/dist/index.mjs`.

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The catch-all | `apps/web/app/api/auth/[...all]/route.ts` | Hands every request to the current Better Auth instance. Writes `auth.rate_limited` for the limiter's own 429. Filters no path |
| The configuration | `packages/core/src/auth/auth.ts` (`createAuth`) | No `disabledPaths`, no `user.changeEmail`, no `user.deleteUser`. `minPasswordLength: 12`; Better Auth's maximum is 128 (`better-auth` `context/create-context.mjs:187`). `hooks.before` covers SSO enforcement and the sign-in hold; `hooks.after` forgives a matched sign-in password; `databaseHooks` cover session, account and user creation only |
| Plugins | `auth.ts:968-1069`, `apps/web/lib/auth.ts:148` | `twoFactor` and `passkey` always; `genericOAuth` when an OIDC provider exists (it adds no endpoint of its own, `better-auth` `plugins/generic-oauth/index.mjs:89`); `sso` when a SAML provider exists; `nextCookies` |
| `/change-password` | `better-auth` `api/routes/update-user.mjs:77-193` | On. A session read from the database (`sensitiveSessionMiddleware`), not a fresh one. Checks the new length, then that a credential account exists, then the current password. With `revokeOtherSessions` it deletes **every** session of the user, the current one included, and makes a new one with its cookie (`:173-188`). No OpenOKR hook, no audit row, no mail, not counted toward the hold. Limited only by the catch-all rule, 100 a minute per address, per process |
| `setPassword` | `update-user.mjs:194-223` | Server only (`createAuthEndpoint.serverOnly`; better-call's router skips `SERVER_ONLY`, `better-call` `router.mjs:22`). Gives a password to an account with none; refuses `PASSWORD_ALREADY_SET`. Checks no freshness |
| Reset | `api/routes/password.mjs:129-166`, `utils/password.mjs:31-46` | Creates a credential account when there is none, so an SSO-only account on a domain that is not enforced can already get a password through Forgot password. `onPasswordReset` clears the hold (`auth.ts:487-494`) |
| `/change-email` | `update-user.mjs:396-518` | Off in configuration: answers 400 `CHANGE_EMAIL_DISABLED`, not 404. When on, it asks for no password. An address another account holds answers `{ status: true }` and sends nothing (`:452-456`); a free one gets a link through `emailVerification.sendVerificationEmail`, awaited inside the request (`context/create-context.mjs:215-225`). With `sendChangeEmailConfirmation` set, the old address must approve first |
| Completing a change | `api/routes/email-verification.mjs:189-241` | The link is a signed token bound to the user id and the old address. A session of another user is refused; **no session is accepted** (`:194-195`). `emailVerified` keeps its old value. Nothing checks that the new address is still free, and `users.email` is unique (`packages/db/src/schema/auth.ts:22`), so a race ends in a database error |
| `/update-user` | `update-user.mjs:14-76` | On. Writes `users.name` and `users.image`. Other fields only if declared; `twoFactorEnabled` is `input: false`. No audit row. `users.image` is read nowhere on screen |
| `/verify-password` | `password.mjs:167-197` | On. Its `scope: "server"` only hides it from the client's types (`utils/hide-metadata.mjs`); the router serves it. A password check behind a session that nothing counts |
| `disabledPaths` | `better-auth` `api/index.mjs:168-170`, `core` `utils/url.mjs` (`normalizePathname`) | Compared with the request path minus the base path and trailing slashes, exactly and case sensitively, before the limiter. Answers 404. **HTTP only**: an `auth.api.*` call never meets it. A path with a parameter can only be listed one value at a time |
| Hooks | `better-auth` `api/to-auth-endpoints.mjs`, `api/dispatch.mjs:143-151` | `hooks.before` and `hooks.after` run for HTTP requests and `auth.api.*` calls alike. `databaseHooks.user.update.after` receives the updated row and the endpoint context (`db/with-hooks.mjs:44-79`) |
| Two names | TECHNICAL-PLAN §4.1; `packages/core/src/actions/people.ts:117-380` | `users.name` is the account's and is copied into a member row when the person joins. `workspace_members.name` is what each workspace shows. `people.updateOwnProfile` (`edit`) takes time zone, avatar, bio, channel, theme, density, language and quiet hours; `people.updateMember` (`full`) takes name, title and manager, and touches only the member row |
| SCIM | `packages/core/src/directory-sync/users.ts`; `apps/web/app/api/scim/v2/Users/[id]/route.ts:166-175` | People are found by address (`accountByEmail`, the `userName eq` filter). PATCH and PUT change `active` and nothing else: "A person's name here is theirs to edit". No column says a directory manages a member; the trace is the `workspace.directoryJoin` audit row and `directory_sync_log` |
| Registration policy | `packages/core/src/workspaces/registration.ts` (`registrationRefusal`) | `open`; `company_domains` refuses a free mail address; `invite_only` refuses anybody without an invitation, and is what `auto` becomes once an instance is claimed |
| SSO enforcement | `packages/core/src/auth/sso-enforcement.ts` | Keyed on the **domain of the account's address** and on membership of the connection's workspace |
| Whether mail can be sent | `packages/core/src/auth/signup-policy.ts`; `apps/web/lib/auth.ts:71-142` | `mail.transport` is `smtp`. Resolved once at boot; `sendVerificationEmail` reaches Better Auth only then |
| The hold | `packages/core/src/auth/lockout.ts` | `recordPasswordAttempt` and `clearSignInAttempts`. Only `/sign-in/email` is counted |
| Audit and outbox | `packages/core/src/audit/instance-chain.ts` (`appendInstanceAuditInTx`); `packages/db/src/outbox.ts`; `packages/core/src/outbox/handlers.ts` | The instance chain and the queue, with a per-topic redaction list |
| Demo accounts | `DEMO_PERSONAS` (`packages/core/src/demo/personas.ts`); `accountBadge` in `apps/web/lib/app-shell.tsx` | An address in the list (`@northwind.example`). The password is published |
| Screens | `apps/web/app/account/page.tsx` (S-51); `apps/web/app/account/security/` | Your account shows the email and links to Security. Security has passkeys, the one-time code, sessions (revoked server side through `auth.api.revokeSession`) and the export. No password card |
| Y7 | `docs/design/account-deletion.md` | Uses "the same recent-sign-in rule Y3's Set a password uses" and a directory-managed refusal. Both are defined here (D2, AS-Q3) |

### 0.1 Where the plan's description differs from the code

| Plan says | The code says |
|---|---|
| Q2's proposal: refused where SCIM manages the member, "because the next sync would put the old name back" | **The sync never writes a name.** PATCH and PUT change `active` only, and provisioning an existing account returns the membership untouched (`directory-join.ts`). AS-Q1 |
| Y4: refused where "the registration policy would refuse the new address at sign-up" | Under `invite_only`, sign-up refuses every address that has no invitation. That is every self-hosted instance after its first account, so the literal reading refuses Y4 almost everywhere. AS-Q2 |
| Y4: "a notice to the old one" | Better Auth has no notice. Its step for the old address is an approval that must be opened before anything else happens. The notice is OpenOKR's to send. AS-Q4 |
| Y4: answered the same way whether or not the address is taken | The body is the same, but a free address waits for the mail callback inside the request and a taken one does not. With today's direct SMTP send, the time taken tells. D17 |
| Y4 names SCIM as the organisation's reason to refuse | **SSO enforcement is keyed on the address's domain.** Moving off the claimed domain would make a password and passkeys work again for somebody the organisation signs in. Refused too (D16) |
| Y3: "after a recent sign-in" | `setPassword` checks no freshness, and Better Auth's `freshAge` (one day by default) is not what recent should mean here. D2 |
| Y6: "starting with `/update-user`" | Twenty-eight more endpoints no screen uses answer today, sixteen of Better Auth's own and twelve from its plugins, several of them worse (§3, §6) |

## 1. Decisions already made

| # | Decided | By, when | What it means here |
|---|---|---|---|
| Q2 | The member and an administrator may change a member's name. Where the change lands is Y5's design to propose and Akmal's to confirm | Akmal, 10 November 2026 | D21 to D24, and AS-Q1 |
| Q3 | No email change where the instance cannot send mail. It takes effect only once the new address's link is used. An administrator changing another member's email is a separate change | Akmal, 10 November 2026 | D14, D18. Not in this design |
| Q5 | The profile is edited on Your account; `/people/<id>` is what other people see | Akmal, 10 November 2026 | Built in Y2. The name field joins the forms there (D22) |
| Y7-2 | A directory-managed member is refused, with "Your organisation's directory manages this account. Ask your administrator." | Akmal, 10 November 2026 | Y4 uses the same sentence and the same predicate (AS-Q3) |
| Account-lockout Q2 | The account holder is mailed when something happens to their sign-in | Akmal, 9 November 2026 | The pattern the password mail follows |

## 2. Decisions this design makes

### 2.1 Shared by every row

| # | Decision | Why |
|---|---|---|
| D1 | **A demo account is refused** Y3, Y4 and Y5, with the sentences in §5. A demo account is one whose address is in `DEMO_PERSONAS`, the test Y1's badge and Y7 already use | The password is published. One visitor changing Priya's password, email or name breaks the demo for every other visitor until the nightly rebuild |
| D2 | **A recent sign-in is a session created in the last 10 minutes.** `RECENT_SIGN_IN_SECONDS = 10 * 60` in `packages/core/src/auth/recent-sign-in.ts`, with `signedInRecently(session, now)`. Used by Set a password, by Y4 for an account with no password, and by Y7. Where it is missing, the card offers "Sign in again with {provider}" for each identity provider the account is linked to, which starts that provider's sign-in with a callback to the same card | Better Auth's `freshAge` is a day and also guards `/unlink-account`; changing it moves other things. A stolen session cookie under a day old must not be enough to give an SSO-only account a password that outlives its removal at the identity provider |
| D3 | **Every password check behind a session counts toward the hold**, not only Y3's. One `hooks.before` branch for `/change-password`, `/verify-password`, `/two-factor/enable`, `/two-factor/disable` and `/two-factor/generate-backup-codes`: read the session (`getSessionFromCtx` from `better-auth/api`); refuse a malformed request first (a new password outside 12 to 128 characters, or no credential account), so it is never counted; then `recordPasswordAttempt` for the session's address and `callerAddress()`; a held attempt gets the existing 429 `SIGN_IN_HELD` unchecked. A `hooks.after` branch clears the counts only when the endpoint succeeded, without marking the address as known | Counting only `/change-password` would leave four uncounted ways to test a password with a stolen cookie. Clearing only on success matters: clearing on "anything but a wrong password" would let a guesser reset the count with a deliberately broken request. **This changes account-lockout.md §7**, which said such checks are not counted |
| D4 | **Y3 and Y4 are account actions, not registry actions.** The code lives in `packages/core/src/auth/account-self-service.ts`; the web app calls it from server actions under `apps/web/app/account/`. REST, the command line, the agent catalogue and chat get no projection | They change how a person signs in, which a token should never do on their behalf (the same reasoning as Y7-Q2). Y5 is different: a name is a workspace fact, so it stays in `people.updateOwnProfile` (D21) |
| D5 | **Every mail goes through the outbox**, built in `packages/core/src/mail/` in the instance's language, English and Malay, with the audit row in the same transaction where there is one (§4) | The relay retries and dead-letters, and the boundary rule already forbids a direct send from a write path |
| D6 | **No address in clear on the instance chain.** An email appears as its domain and a keyed hash: HMAC-SHA-256 under a key derived from `BETTER_AUTH_SECRET` with the label `openokr:account-audit`, as `lockout.ts` derives its keys | The chain is permanent and outlives erasure. A domain shows a move off a company; the hash lets somebody holding the secret confirm a suspected address without the chain naming anyone |

### 2.2 Y3: change your password, and set one

| # | Decision | Why |
|---|---|---|
| D7 | **A Password card on Security**: current password, new password, new password again, and "Sign out my other devices", ticked. It calls Better Auth's `/change-password` through `authClient.changePassword`, like the one-time-code form on the same page calls `/two-factor/enable` | The screen and a direct call then reach the same endpoint, so one guard covers both. No second path to keep in step |
| D8 | **Refused before the endpoint runs**, in the `hooks.before` branch of D3: a demo account (D1); an account SSO enforcement claims, with `enforcementMessage`; then D3's shape check and hold | A password the sign-in will refuse anyway is worth nothing, and refusing first keeps Better Auth from ending sessions for a change that then fails at session creation (the enforcement backstop throws inside `createSession`, after the sessions are gone) |
| D9 | **One function records a password change**: `recordPasswordChange(pool, { userId, via, otherSessionsEnded, address })` opens one transaction on the pool with the instance-admin flag, appends `auth.password_changed`, and queues `account.passwordChanged`. Called from three places, one per way a password changes: `hooks.after` on `/change-password` when it succeeded (`via: "change"`, the user from the returned body), `onPasswordReset` (`via: "reset"`), and Set a password's server action after `auth.api.setPassword` returns (`via: "set"`). A failure is logged and counted and never undoes the change | Every way in is covered: the screen and a direct call both pass the hook, the reset has its own callback, and `setPassword` is server only, so only OpenOKR's code calls it. Sign-up's first password is not a change. The inventory test (D27) fails if Better Auth ever adds another endpoint that could write one |
| D10 | **"Sign out my other devices" is Better Auth's `revokeOtherSessions`**: every session ends and this browser gets a new one. API tokens, device tokens and connected apps are not touched (AS-Q6), and the success sentence says so with links to both pages | What the checkbox does must be exactly what it says |
| D11 | **`LIMIT_RULES` gains `/change-password`, 10 a minute per network**, so every replica shares the count (account-lockout.md D10) | Today it falls under the 100-a-minute catch-all, counted in each process |
| D12 | **Set a password** replaces the Password card when the account has no password. Refused for a demo account or an enforced one. Needs D2's recent sign-in. Two fields and a Save; the server action calls `auth.api.setPassword` and then D9 | The plan's row. The reset path already gives such an account a password through the mailbox; this is the signed-in way, held to the same freshness Y7 uses |
| D13 | **A completed reset mails too** (D9, `via: "reset"`) | It is a change of password. Somebody with brief access to the mailbox should not be able to take the account in silence |

### 2.3 Y4: change your sign-in email

| # | Decision | Why |
|---|---|---|
| D14 | **Offered only where mail can be sent**, judged by the same boot-time answer Better Auth is built with: `apps/web/lib/auth.ts` exports `canSendMail()`, reading the value `resolveSignupPolicy` stored. `createAuth` gets `user.changeEmail.enabled` from the same answer. No `sendChangeEmailConfirmation` (AS-Q4), no `updateEmailWithoutVerification` | The page and the endpoint can then never disagree. Changing `mail.transport` needs a restart, as confirmation on sign-up already does |
| D15 | **Only the server action reaches the change.** `/change-email` and `/verify-password` are in `disabledPaths` (Y6); the action calls `auth.api.verifyPassword` and `auth.api.changeEmail`, which `disabledPaths` does not touch | Better Auth's endpoint asks for no password and cannot run OpenOKR's refusals in one place with the body and the session together |
| D16 | **The request, in this order.** (1) What depends only on the asker's own account: demo (D1), directory-managed (AS-Q3), SSO enforced. (2) The address: well formed, not the current one, and allowed by the address rule (AS-Q2). (3) Proof: the current password through `auth.api.verifyPassword`, counted by D3, or D2's recent sign-in for an account with no password. (4) Limits, in the Postgres cache: 3 requests a day per account, and 3 a day per new address, keyed by D6's hash. (5) One branch: a taken address queues `account.emailChangeTaken` (AS-Q5); a free one calls `auth.api.changeEmail`, whose callback queues `account.changeEmail`. Either way `account.emailChangeNotice` is queued to the current address and `auth.email_change_requested` is appended. (6) The same answer | Refusals that come before the address can say nothing about another account. The per-address limit counts every address alike, so its refusal says nothing either |
| D17 | **The answer is the same sentence, no sooner than 500 ms** after the request began, whichever branch ran | Each branch is one lookup and a few inserts now that no mail is sent inside the request; the floor covers what is left, as Better Auth's own resend does |
| D18 | **The link's mail**: OpenOKR's `sendVerificationEmail` callback reads the token with `verifyJWT` from `better-auth/crypto`. A token carrying `updateTo` is a change link and queues `account.changeEmail` with `{ userId, from, to, url, expiresAt }`; anything else is a confirmation link and is handled as today, or as S3 builds it. The handler skips the send when the account is gone, its address is no longer `from`, or `expiresAt` has passed. `to` and `url` join `OUTBOX_REDACT_ON_DELIVERY` | One callback serves both kinds of link, and S3's handler would skip a change link as "its address changed" |
| D19 | **Completing needs a live session of the same account.** A `hooks.before` branch on `/verify-email` verifies the token with `verifyJWT` and, for a change link only: with no session, redirects to sign-in with "Sign in, then open the link in your email again."; then re-checks D16 (1) and (2) and that the new address is still free, refusing with a redirect to `/account?emailChange=<reason>`. A session of another account is Better Auth's own `INVALID_USER` | A thief who opens their own link with no session would otherwise win even after the owner changed the password and signed every device out. With this, that change cancels every unopened link. It also turns the unique-index error into a sentence |
| D20 | **On completion**, a `databaseHooks.user.update.after` branch for `/verify-email` whose token is a change link appends `auth.email_changed`. S3's `auth.email_verified` is not written for a change | The hook runs exactly once per real update; a second click fails earlier with `INVALID_TOKEN`. A change is not a first confirmation |
| D21 | **What moves with the address**: sign-in, every mail, the `userName` SCIM answers, which SSO connection claims the account, and trusted-domain offers. Member rows hold no address and are untouched. Pending invitations to either address stay as they are | Listed so nothing is assumed to follow that does not |

### 2.4 Y5: change your own name

| # | Decision | Why |
|---|---|---|
| D22 | **`people.updateOwnProfile` gains `name`**, trimmed, 1 to 200 characters, the schema `people.updateMember` uses. One Operation writes this workspace's member row and, when the member has an account, `users.name`, in the same transaction, marked `openokr:allow-mutation` as erasure's write to `users` is. Other workspaces keep their names. The audit row's `changed` gains `"name"`, never the value; the activity is `member.profile_updated`, as today. A demo account is refused (D1). **A directory-managed member is not refused** (AS-Q1). The contract projections are regenerated | Q2's proposal, with the SCIM refusal dropped because the sync never writes a name. `users.name` is what a new workspace starts from, so it follows the person's latest choice; another workspace's administrator may have set the name there |
| D23 | **The screen**: the name on Your account becomes the kit's `TextInput` with Save, in the "who you are" card. Title and manager stay read only, and the note under them names only those two | Q5 put the self-edit forms on Your account |
| D24 | **An administrator's rename stays local**: `people.updateMember` changes this workspace's member row only, never `users.name`. An administrator renames themselves on Your account like anybody else; the profile card stays hidden on their own profile | The account's name is the person's own. One workspace's administrator does not decide what the next workspace sees |
| D25 | **`/update-user` goes off** (Y6), so `users.name` has two writers: account creation and D22 | A write nobody records is the problem the plan names |

### 2.5 Y6: the endpoints nobody uses

| # | Decision | Why |
|---|---|---|
| D26 | **`disabledPaths` lists every static path marked off in §3.** The SSO plugin also gets `providersLimit: 0`, so even a server call cannot register a provider | Better Auth's own mechanism, as the plan says. It leaves `auth.api` calls working, which D12 and D15 need. `providersLimit` is the plugin's own off switch for registration (`sso` `:3363-3364`) |
| D27 | **The inventory is code**: `AUTH_ENDPOINTS` in `packages/core/src/auth/endpoints.ts`, one entry per path with its methods, on or off, and the reason. `disabledPaths` is built from it. A test builds `createAuth` with an OIDC and a SAML provider, so every plugin is mounted, reads the route table from `auth.api` (path, methods, `SERVER_ONLY`), and fails naming any endpoint the inventory lacks or lists in vain | A default that an upgrade switches on becomes a red build on the pull request that brings it, which is the plan's ask |
| D28 | **Three paths with a parameter stay on**, because `disabledPaths` cannot name them and each is harmless with D26 in force (§3) | Refusing them by prefix in a hook would be a second mechanism for little gain |

## 3. The endpoint inventory

59 paths when every plugin is mounted: 30 stay on, 29 go off. "Today" is on for all of them; `/change-email` and `/delete-user` answer an error from their handler rather than 404.

| Path | Method | After Y6 | Why |
|---|---|---|---|
| `/sign-up/email` | POST | on | Sign-up |
| `/sign-in/email` | POST | on | Sign-in |
| `/sign-in/social` | POST | on | OIDC sign-in buttons |
| `/callback/:id` | GET, POST | on | OIDC return |
| `/sign-out` | POST | on | Harmless; the browser client may call it |
| `/get-session` | GET, POST | on | Reads the caller's own session; the browser client may ask after a sign-in |
| `/request-password-reset` | POST | on | Forgot password |
| `/reset-password/:token` | GET | on | The reset mail's link |
| `/reset-password` | POST | on | The reset form |
| `/send-verification-email` | POST | on | S3's resend |
| `/verify-email` | GET | on | Confirmation and change links (D19) |
| `/error` | GET | on | Where a failed provider sign-in lands |
| `/change-password` | POST | **on, guarded** | Y3 (D3, D8, D9, D11) |
| `/change-email` | POST | off | Y4 calls `auth.api.changeEmail` (D15) |
| `/verify-password` | POST | off | An uncounted password check; Y4 and Y7 call `auth.api.verifyPassword` |
| `/update-user` | POST | off | Unrecorded writes to `users.name` and `users.image` (D25) |
| `/update-session` | POST | off | No session field to update |
| `/delete-user` | POST | off | Y7 has its own flow |
| `/delete-user/callback` | GET | off | The same |
| `/list-sessions` | GET | off | Security reads through the adapter (`session.ts`) |
| `/revoke-session` | POST | off | Security revokes through `auth.api` |
| `/revoke-sessions` | POST | off | No screen. A stolen cookie could sign the owner out everywhere |
| `/revoke-other-sessions` | POST | off | No screen. Y3's checkbox does it inside `/change-password` |
| `/list-accounts` | GET | off | No screen |
| `/link-social` | POST | off | No screen; sign-in links through its callback |
| `/unlink-account` | POST | off | No screen. Removes a password or a provider link with no record |
| `/get-access-token` | POST | off | Hands the identity provider's access and ID tokens, sealed at rest since L-11, to any holder of the session cookie |
| `/refresh-token` | POST | off | The same, refreshed |
| `/account-info` | GET | off | Calls the identity provider with the stored token |
| `/ok` | GET | off | No screen and no probe uses it |
| `/two-factor/enable` | POST | on | Security (counted, D3) |
| `/two-factor/verify-totp` | POST | on | Sign-in and enrolment |
| `/two-factor/verify-backup-code` | POST | on | Sign-in |
| `/two-factor/disable` | POST | on | No screen, but the only way to turn a second factor off; counted (D3) |
| `/two-factor/generate-backup-codes` | POST | on | No screen, but the only way to get new codes; counted (D3) |
| `/two-factor/get-totp-uri` | POST | off | No screen; enabling returns the URI |
| `/two-factor/send-otp` | POST | off | No code sender is configured |
| `/two-factor/verify-otp` | POST | off | The same |
| `/passkey/generate-register-options` | GET | on | Add a passkey |
| `/passkey/verify-registration` | POST | on | The same |
| `/passkey/generate-authenticate-options` | GET | on | Sign in with a passkey |
| `/passkey/verify-authentication` | POST | on | The same |
| `/passkey/list-user-passkeys` | GET | on | Security |
| `/passkey/delete-passkey` | POST | on | Security |
| `/passkey/update-passkey` | POST | off | No screen |
| `/sign-in/sso` | POST | on | SAML sign-in button (SSO plugin, mounted only with a SAML provider, from here down) |
| `/sso/saml2/sp/acs/:providerId` | GET, POST | on | SAML return |
| `/sso/saml2/sp/metadata` | GET | on | What an identity provider is configured from; public by design |
| `/sso/saml2/sp/slo/:providerId` | GET, POST | on | Has a parameter (D28). A provider's logout request only ends sessions |
| `/sso/saml2/logout/:providerId` | POST | on | Has a parameter. Needs a session; signs the caller out |
| `/sso/callback/:providerId` | GET | on | Has a parameter. Answers only for an OIDC provider the plugin itself holds; `saml-sync.ts` writes SAML rows only, and D26 stops new ones |
| `/sso/callback` | GET | off | No OIDC provider lives in the plugin |
| `/sso/register` | POST | off | Any signed-in person can register up to 10 providers today (§6) |
| `/sso/providers` | GET | off | OpenOKR manages providers in `sso_connections` |
| `/sso/get-provider` | GET | off | The same |
| `/sso/update-provider` | POST | off | The same |
| `/sso/delete-provider` | POST | off | The same |
| `/sso/request-domain-verification` | POST | off | The same |
| `/sso/verify-domain` | POST | off | The same |

`setPassword`, `generateTOTP` and `viewBackupCodes` are server only and never served; D12 calls the first.

## 4. Audit events and mails

### 4.1 Instance chain

| Action | Payload | When |
|---|---|---|
| `auth.password_changed` | `{ userId, via: "change" \| "set" \| "reset", otherSessionsEnded, address }` (`address` from `callerAddress()`, as `auth.rate_limited` records it) | Every password change, in the transaction that queues its mail (D9) |
| `auth.email_change_requested` | `{ userId, toDomain, toKey, outcome: "link_sent" \| "address_taken" }` | An accepted request (D16), bounded by its limits. Refusals write nothing |
| `auth.email_changed` | `{ userId, fromDomain, fromKey, toDomain, toKey }` | A link completed the change (D20) |

Y5 writes no instance row: its record is the workspace chain's `people.updateOwnProfile` row with `changed: ["name"]`. Y6 writes nothing.

### 4.2 Mails

| Topic | To | Says | Redacted on delivery | Skipped when |
|---|---|---|---|---|
| `account.passwordChanged` | The account's address | "The password for {email} was changed on {date} at {time} UTC." ("was set", "was reset" for the other two.) Whether other devices were signed out. "If this was not you, reset your password now." with a button to `/forgot-password`. Never the password, never a link that changes it | `to` | The account is gone |
| `account.changeEmail` | The new address | "Open this link to make {new} the email you sign in to {instance} with. It works for {lifetime}. If you did not ask for this, ignore this mail and nothing changes." | `to`, `url` | Account gone, address no longer `from`, expired |
| `account.emailChangeNotice` | The current address | "Somebody signed in to your account asked to make {new} its sign-in email, on {date}. If that was you, follow the mail sent to {new}. If it was not, change your password and sign out your other devices: an unopened link then stops working." The same words in both branches | `to`, `newEmail` | The account is gone |
| `account.emailChangeTaken` (AS-Q5) | The new address | "Somebody asked to make this address the sign-in email of an account on {instance}. It already has an account here, so nothing changed. If you have forgotten your password, you can reset it." | `to` | Never |

Idempotency keys: the change link and the notice by the SHA-256 of the token; the password mail and the taken mail by a fresh request id. With the console transport each mail reaches the server log, as every mail does.

## 5. What is refused, and the sentence

| Where | Case | Sentence |
|---|---|---|
| Password | Demo account | "Demonstration accounts keep their password. Anyone can sign in to them, so anyone could change it." |
| Password | SSO enforced | `enforcementMessage`, unchanged: "Accounts on {domain} sign in with {provider}. Use that button on the sign-in page. A password, a reset link and a passkey will not work for this address." |
| Password | Wrong current password | "That password was not right." (the existing key), and it counts |
| Password | Held | "Too many attempts for this address. Try again in {n} minutes, or reset your password." (account-lockout.md D12) |
| Password | New one too short or too long | "Use at least 12 characters." / "Use at most 128 characters." Not counted |
| Password | The two new ones differ | "The two new passwords are not the same." In the browser |
| Password | Done | "Your password is changed. Your other devices are signed out. API tokens and connected apps keep working." (or "Your other devices stay signed in.") |
| Set a password | No recent sign-in | "To set a password, sign in again first. It keeps somebody who finds your open session from setting one." with "Sign in again with {provider}" |
| Set a password | Done | "Your password is set. You can now sign in with it or with {provider}." |
| Email | Mail cannot be sent | "Changing your sign-in email needs this instance to send mail, and it does not yet. Ask whoever runs it to set up mail." No form |
| Email | Demo account | "Demonstration accounts keep their email. Anyone can sign in to them, so anyone could change it." |
| Email | Directory-managed | "Your organisation's directory manages this account. Ask your administrator." (Y7-2's sentence) |
| Email | SSO enforced | "{provider} signs you in to {domain} addresses, so your sign-in email is your organisation's to change. Ask your administrator." |
| Email | The current address | "That is already your sign-in email." |
| Email | Company addresses only (AS-Q2) | "This instance accepts company email addresses only. Use your company address." |
| Email | Wrong password, held | As for Password, and it counts |
| Email | No password, no recent sign-in | "To change your email, sign in again first." with the provider buttons |
| Email | Three today from this account | "You have asked to change your email three times today. Try again tomorrow." |
| Email | Three today for that address | "Too many changes have been asked for that address today. Try again tomorrow." |
| Email | Accepted, either branch | "Check {new}. We sent a link there. Your sign-in email changes when you open it, within {lifetime}. Until then, sign in with {current}." |
| The link | Not signed in | Sign-in shows "Sign in, then open the link in your email again." |
| The link | Another account's session | "This link is for another account. Sign out, sign in to that account and open it again." |
| The link | Address taken since | "{new} now belongs to another account, so your email was not changed." |
| The link | Any D16 refusal since | That case's sentence, then "so your email was not changed." |
| The link | Expired | "This link has expired. Ask for a new one on Your account." |
| The link | Not valid or already used | "This link is not valid. It may have been used already, or copied only in part." |
| The link | Done | Your account shows "Your sign-in email is now {new}." |
| Name | Demo account | "Demonstration accounts keep their name. Anyone can sign in to them, so anyone could change it." |
| Name | Empty, too long | "A member needs a name." (existing) / "Use at most 200 characters." |
| Any off path | | 404, Better Auth's own "Not Found". No sentence |

Every field is the kit's (`PasswordInput`, `EmailInput`, `TextInput`), every answer sits in a polite live region, and a pressed button shows its progress, as Security's other forms do.

## 6. Threat cases

| Concern | Without this design | With it |
|---|---|---|
| **A stolen session cookie**, no password | Change the password? No: it needs the current one, but each guess is free (no hold). Test passwords through `/verify-password` or the two-factor endpoints, uncounted. Read the identity provider's tokens through `/get-access-token`. Sign the owner out everywhere through `/revoke-sessions` | Every password check counts toward the hold (D3). The token, revocation and verification doors are off. Setting a password on an SSO-only account needs a sign-in in the last 10 minutes and mails the owner. An email change needs the password. A rename is allowed and recorded in the workspace chain; a name is shown, never trusted |
| **A stolen password** | Change the password with no record and no mail | The owner is mailed; a reset from their mailbox recovers, and with S3's D15 ends every session. Moving the account to the thief's address mails the owner at once (D16); because completion needs a live session (D19), the owner's password change with sign-out stops an unopened link. **Left open**: a thief who opens their own link at once. AS-Q4's option (b) closes that, at a cost |
| **Finding out who has an account** | Not reachable today | The answer is one sentence after at least 500 ms, and one notice is queued either way (D16, D17). Every refusal before the address depends only on the asker's own account; the address rule depends only on the domain. The per-address limit counts every address alike. "Taken since" is shown only to whoever holds a link sent to that mailbox |
| **A direct call that skips the screen** | `/change-password` changes the password unrecorded | The guard is on the endpoint, so the screen and a direct call meet it alike. `/change-email`, `/verify-password`, `/update-user` and the rest of §3's off list answer 404. A Better Auth upgrade that adds an endpoint fails D27's test |
| **SCIM drift** | Not reachable today | The directory finds people by address. A moved address makes its next lookup miss and provision a second account at the old one, so a directory-managed member cannot change their email. Names are not refused, because the sync never writes one (AS-Q1); the directory sees a different `displayName` on its next read and cannot change it |
| **Escaping SSO enforcement** | Not reachable today | Moving off a claimed domain would let a password and passkeys work again for someone the organisation signs in. Refused at request and again at completion |
| **Escaping the address rule** | Not reachable today | Under `company_domains`, a free mail address is refused at request and at completion |
| **Demo griefing** | Any visitor can change a persona's password with one direct call, or turn on a one-time code from Security with the published password, and lock every other visitor out until the rebuild | Y3, Y4 and Y5 refuse a demo account (D1). The one-time code is AS-Q8 |
| **Flooding a mailbox** | Not reachable today | Three requests a day per account and three per target address. One mail per password change |
| **A leaked change link** | Not reachable today | Bound to the account and its old address, works only inside a session of that account, and expires. A second link stays usable until it expires, as confirmation links do |
| **SSO providers managed from outside** | With SAML configured, any signed-in person can register up to 10 providers through `/sso/register`, writing rows into `sso_providers`, which OpenOKR treats as derived from `sso_connections`, and making the server fetch a public discovery URL outside the outbound port. Better Auth's defaults (no `trustEmailVerified`, no domain verification) stop such a provider attaching to an existing account, and the registration hook still polices new ones, so no takeover was found | Off, and `providersLimit: 0` |
| **An open redirect** | | The server action passes fixed paths; Better Auth checks `callbackURL` against the instance's origin on the request and the link |

## 7. Settings

**None.** Every number is a constant in `packages/core/src/auth/`, as account-lockout.md D14 and email-verification.md D11 do: a security floor nobody should have to choose. Nothing goes in TECHNICAL-PLAN §4.14 or METHOD.md §11. The one input is the existing `mail.transport`, read at boot.

| Number | Value | Home |
|---|---|---|
| Recent sign-in | 10 minutes | `RECENT_SIGN_IN_SECONDS`, `recent-sign-in.ts` |
| Password length | 12 to 128 | `minPasswordLength` (exists), Better Auth's maximum |
| `/change-password` per network | 10 a minute | `LIMIT_RULES` |
| Email changes per account | 3 a day | `account-self-service.ts` |
| Email changes per target address | 3 a day | `account-self-service.ts` |
| Answer floor | 500 ms | `account-self-service.ts` |
| Change link lifetime | `EMAIL_VERIFICATION_LINK_SECONDS` | `auth.ts`. Better Auth has one `expiresIn` for both kinds of link, so S3's Q1 sets this too |

## 8. Acceptance criteria

**Y3**

- Given an account with a password, when its holder submits the right current password and a new one of 12 characters with the box ticked, then the password changes, every other session ends, this browser stays signed in, one `auth.password_changed { via: "change", otherSessionsEnded: true }` row is appended, and one `account.passwordChanged` row is queued in the same transaction.
- Given the box unticked, then the other sessions survive and the row says `otherSessionsEnded: false`.
- Given a direct `POST /api/auth/change-password` with the right current password, then the same row and the same mail follow.
- Given five wrong current passwords from one network, when a sixth arrives, then it gets 429 `SIGN_IN_HELD` with `Retry-After` and the password is not checked.
- Given a new password of 11 characters, then the answer is "Use at least 12 characters." and nothing is counted.
- Given a wrong password at `/two-factor/enable`, then it counts toward the same hold.
- Given a demo account, or an account SSO enforcement claims, then the card shows its sentence and a direct call gets 403 with no session ended.
- Given 11 requests in a minute from one network across two processes, then the eleventh gets the limiter's 429 and one `auth.rate_limited` row.
- Given an account with no password and a session 20 minutes old, then the card offers "Sign in again with {provider}"; when they sign in through it and set a password within 10 minutes, then the password is set, one `auth.password_changed { via: "set" }` row is appended and the mail is queued.
- Given a completed reset, then one `auth.password_changed { via: "reset" }` row is appended and the mail is queued.
- Given a sign-up, or `pnpm demo:prepare` setting a persona's password, then no `auth.password_changed` row is written.

**Y4**

- Given an instance with the console mail transport, then the email card shows "Changing your sign-in email needs this instance to send mail..." and no form, and the server action refuses.
- Given SMTP, a signed-in account and the right password, when a free address is asked for, then the answer is the accepted sentence, one `account.changeEmail` row is queued to the new address, one `account.emailChangeNotice` row to the current one, one `auth.email_change_requested { outcome: "link_sent" }` row is appended, and `users.email` is unchanged.
- Given an address another account holds, when it is asked for, then the answer has the same sentence, takes at least 500 ms, queues `account.emailChangeTaken` (AS-Q5) and the same notice, and sends no link.
- Given a demo account, a directory-managed one, or an SSO-enforced one, then the card shows that case's sentence before any address is typed.
- Given `company_domains` and a free mail address, then it is refused with the company sentence; given `invite_only`, then it is accepted (AS-Q2).
- Given a wrong password, then it is refused and counted.
- Given an account with no password and no sign-in in the last 10 minutes, then it is refused with the sign-in-again sentence.
- Given three requests today from one account, when a fourth is made, then it is refused with the account sentence; given three requests today for one address from three accounts, when a fourth asks for it, then it is refused with the address sentence whether or not that address has an account.
- Given a change link, when it is opened while signed in to the account, then `users.email` becomes the new address, `emailVerified` stays true, one `auth.email_changed` row with domains and keys and no address is appended, no `auth.email_verified` row is written, and Your account says "Your sign-in email is now {new}."
- Given a change link, when it is opened signed out, then nothing changes and sign-in says to sign in and open the link again.
- Given a request, when the owner then changes the password with "Sign out my other devices" before the link is opened from another browser, then the link changes nothing.
- Given the new address registered by somebody else before the link is opened, then nothing changes and the "now belongs to another account" sentence shows.
- Given a link already used, when it is opened again, then it is refused as not valid and no second `auth.email_changed` row is written.
- Given any delivered `account.changeEmail` row, then its payload holds neither `to` nor `url`.

**Y5**

- Given a member of two workspaces, when they change their name on Your account in the first, then the first workspace's member row and `users.name` change, the second workspace's member row does not, and the workspace audit row has `changed: ["name"]` and no name in it.
- Given a member a directory manages, then the change is allowed (AS-Q1).
- Given a demo account, an empty name, or 201 characters, then each is refused with its sentence.
- Given an administrator renaming another member, then `users.name` of that member is unchanged.
- Given a direct `POST /api/auth/update-user`, then the answer is 404 and `users.name` is unchanged.

**Y6**

- Given every plugin mounted, when the inventory test runs, then each path in `auth.api` is in `AUTH_ENDPOINTS` and each entry exists; adding a fake endpoint to a plugin fails it naming the path.
- Given each off path, when it is requested through the route, including with a trailing slash, then the answer is 404 and the endpoint does not run; an upper-cased or percent-encoded variant also gets 404.
- Given `/change-email` and `/verify-password` off, then `auth.api.changeEmail` and `auth.api.verifyPassword` still work from server code.
- Given a SAML provider configured, when a signed-in person posts to `/api/auth/sso/register`, then the answer is 404, and a server call to register a provider is refused.

## 9. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/auth-endpoint-inventory.test.ts` (new) | D27: the route table with every plugin mounted, both ways; `disabledPaths` equals the off static paths; `SERVER_ONLY` excluded |
| Integration | `packages/core/test/auth-disabled-paths.test.ts` (new) | Each off path 404 through `auth.handler`, with the variants; the `auth.api` calls that must still work; `providersLimit: 0` |
| Integration | `packages/core/test/password-change.test.ts` (new) | Y3's criteria: rows and mail per way in, both box states, refusals, the limiter, Set a password with a fake clock, nothing for sign-up and the demo command |
| Integration | `packages/core/test/sign-in-lockout.test.ts` (existing) | D3: each session path counted, cleared only by success, a malformed request not counted |
| Integration | `packages/core/test/email-change.test.ts` (new) | Y4's criteria with SMTP stood in by the outbox: both branches' rows and timing floor, every refusal, both limits, completion signed in, signed out, after a password change, after a race, twice |
| Integration | `packages/core/test/people-own-name.test.ts` (new) | Y5's criteria through `callAction` and the test-support factory |
| Unit | `packages/core/src/outbox/handlers.test.ts` (existing) | The four topics: skips, sends, redaction |
| Unit | The mail builders' test in `packages/core/src/mail/` | The four mails, English and Malay |
| Unit | `apps/web/test/auth-route.test.ts` (existing) | An off path answers 404 through the route and writes no audit row |
| Contract | `pnpm check:contract` | `people.updateOwnProfile` gains `name` |
| End to end | `e2e/s51-account-self-service.spec.ts` (new) | Rename and see it in the avatar menu's header; change the password, sign out, sign in with the new one; a wrong current password shows its sentence; the email card on the suite's console transport shows the not-offered sentence. The email happy path is the integration suite's and staging's (SMTP), as S3's is |
| Accessibility | `e2e/s43-accessibility.spec.ts` (existing) | Already walks `/account` and `/account/security` |

## 10. What the specification gains

| Page | Change |
|---|---|
| TECHNICAL-PLAN §8.2, Sessions | Change password with "sign out my other devices", Set a password after a recent sign-in, and the mail |
| TECHNICAL-PLAN §8.2, Brute force | Password checks behind a session count toward the hold; `/change-password` joins the shared limits |
| TECHNICAL-PLAN §8.2, a new row "Account changes" | Changing the sign-in email: when it is offered and refused, the link, completion inside a session, the three audit rows |
| TECHNICAL-PLAN §8.2, a new row "Authentication endpoints" | The inventory and `disabledPaths`, and the test that pins them |
| TECHNICAL-PLAN §4.1 and the comment at the top of `people.ts` | The self-versus-others split now gives the name to both, and who writes `users.name` |
| `docs/design/account-lockout.md` §7 | The line about session password checks, now counted |
| UIUX-PLAN S-51 | The editable name, the email card and its states |
| UIUX-PLAN S-35 | The Password and Set a password cards on Security; the sign-in line for a change link opened signed out |
| `docs/design/email-templates.md` | The four mails |
| `docs/admin/security.md` | "Changing a password or an email", and the endpoint list |
| English and Malay message files | §5's sentences |
| The plan, §12 | Y3 to Y6, and a changeset per row |

## 11. Building it, and what it meets

**Order**: Y6 first, so `/change-email` and `/verify-password` are off and pinned before anything turns the change on. Then Y3, which brings D3's counting that Y4 needs. Then Y5. Y4 last. One commit each.

**S3** (`email-verification.md`, not yet approved) rewrites the same `sendVerificationEmail` callback. Whichever lands second adds its branch to the first's. S3's D13 sets this link's lifetime too. S3's D15, a reset ending every session, is what makes "reset your password" in §4.2's mails a full recovery.

**Y7** (`account-deletion.md`) shares D1's demo test, D2's recent sign-in, D3's counting of its password check through `auth.api.verifyPassword`, and AS-Q3's directory predicate.

## 12. What this does not do

- No administrator changing another member's email (Q3), and no username (plan Q1).
- No change to a name in another workspace, and no rewrite of names already in the feed, which keeps the name an event was written with.
- No revocation of API tokens, device tokens or connected apps by "sign out my other devices" (AS-Q6).
- No stored pending email change: a second request does not cancel the first link, and a reload does not show one waiting.
- No screen to turn off a second factor or make new backup codes. Their endpoints stay on and counted; a screen, with an audit row, is a later change.
- No change to the billing provider's customer address when an owner's email changes.
- No change to how SCIM writes: still `active` only.
- No move of the reset mail or the held-sign-in notice onto the outbox; S3 §9 leaves them as direct sends.
- No CAPTCHA, which would need an outside service an air-gapped instance cannot reach.

## 13. Questions for Akmal

**AS-Q1. Y5: where a name change lands, and is a directory-managed member refused?**

| Option | For | Against |
|---|---|---|
| (a) Q2's proposal as written: this workspace's member row and `users.name`; other workspaces keep theirs; refused where SCIM manages the member | What the plan says | The stated reason does not hold: the sync never writes a name. A person whose directory spells them wrongly could never fix it themselves |
| **(b) The same, without the SCIM refusal** | Matches the code, and the SCIM route's own comment: "A person's name here is theirs to edit" | The directory reads back a `displayName` that differs from what it holds, which an identity provider's logs may show as drift |
| (c) Every workspace's member row as well | One name everywhere | Overwrites a name another workspace's administrator chose |

**Recommended: (b).**

**AS-Q2. Y4: what "the registration policy would refuse the new address" means.**

| Option | For | Against |
|---|---|---|
| **(a) Only the address rule**: under `company_domains`, a free mail address is refused; `invite_only` refuses nothing | `invite_only` decides who may create an account, not where an existing account's mail goes | An `invite_only` instance has no say over which domain its people move to |
| (b) Literally: refused whenever sign-up would refuse that address without an invitation | The plan's words | Refuses every change on every self-hosted instance after its first account, so Y4 would exist only on open instances and clouds |

**Recommended: (a).**

**AS-Q3. Which accounts does a directory manage?** Y4 and Y7-2 both need the answer, and nothing stores it today.

| Option | For | Against |
|---|---|---|
| **(a) The account is an active member of any workspace with a live directory token** (not revoked, not expired), read workspace by workspace under each one's tenant setting | No migration. Covers members a directory adopted by looking them up, which leaves no trace | Also refuses a person invited by hand into a workspace that runs a directory. They ask an administrator, which Q3 leaves to a later change |
| (b) A marker on the member row, set by any SCIM write that touches them, with a backfill from `directory_sync_log` | Exact for members the directory has written to | **A migration**, so a separate approval, and still blind to adoption by lookup until the directory's first write |
| (c) Read the `workspace.directoryJoin` audit rows | No migration | Blind to adoption by lookup, and an access decision read from the audit trail |

**Recommended: (a) for 0.8.0**, with Y7's wording following it.

**AS-Q4. Y4: how much the old address has to agree.**

| Option | For | Against |
|---|---|---|
| **(a) The plan's notice, plus the password to start and a live session to finish** (D16, D19) | Somebody who lost the old mailbox, the usual reason to change, can still move. The owner's password change with sign-out cancels any unopened link | A thief with the password who opens their own link at once has moved the account before the owner reads the notice |
| (b) Better Auth's own step: the old address must approve before the new one gets its link | A stolen password alone can no longer move the account | A person who has lost the old mailbox can never change it, and an administrator cannot either until a later change |

**Recommended: (a).** A stolen password already lets the thief change the password; (b) protects only the email, and costs the people the feature is for.

**AS-Q5. Y4: does the new address hear anything when it already has an account?**

| Option | For | Against |
|---|---|---|
| (a) Nothing, Better Auth's default | No new message kind | The person waits for a link that never comes. The branches do different work, which the floor has to hide |
| **(b) "This address already has an account here, so nothing changed."** | Nobody waits for nothing. Both branches queue one mail, so the timing matches by construction. Only whoever holds that mailbox learns anything, and they could already learn it with Forgot password | A new kind of message, which is yours to decide, and one more mail an outsider can cause, within the per-address limit |

**Recommended: (b).**

**AS-Q6. Does "Sign out my other devices" also revoke API tokens, device tokens and connected apps?**

| Option | For | Against |
|---|---|---|
| **(a) Sessions only, said on the screen and in the mail, with links to API tokens and Connected apps** | What the words say. A password change does not break the person's integrations by surprise | Someone recovering from a takeover must also check two more pages |
| (b) Revoke them all too | One action cleans up | Silently breaks every integration and agent connection on every routine password change |
| (c) A second box, unticked | The choice is the person's | One more decision on a short form |

**Recommended: (a).**

**AS-Q7. Y6: a deny list or an allow list?**

| Option | For | Against |
|---|---|---|
| **(a) Better Auth's `disabledPaths`, built from the inventory, with D27's test** | The plan's mechanism. Better Auth's own, so `auth.api` calls are untouched and its route table is the truth the test reads. A new endpoint fails CI on the pull request that brings it | Open by default at runtime: an endpoint that reached production without the test running would answer. Paths with a parameter cannot be listed |
| (b) An allow list in the catch-all route, refusing anything not listed before Better Auth sees it | Closed by default at runtime, parameters included | The route reimplements Better Auth's path matching, a second list to keep exact, and the plan names (a) |

**Recommended: (a).** Every dependency update reaches `main` through a pull request whose CI runs the test.

**AS-Q8. Should D1's demo refusal also cover the one-time code?** Today a visitor signed in as a persona can turn on a one-time code from Security with the published password, and every other visitor is then asked for a code they do not have, until the nightly rebuild.

| Option | For | Against |
|---|---|---|
| **(a) Yes, in Y3's commit**: D3's hook already sees `/two-factor/enable` and `/two-factor/disable`; Security shows "Demonstration accounts keep their sign-in as it is. Anyone can sign in to them." in place of the form | One line in a hook that exists for this row. Closes a lock-out any visitor can cause | Beyond the plan's Y3 wording |
| (b) Leave it to a later change | Y3 stays exactly the row | The demo stays breakable from a screen, not only by a direct call |

**Recommended: (a).**
