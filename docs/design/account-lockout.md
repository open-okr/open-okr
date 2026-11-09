# Account lockout with backoff

Status: proposed 9 November 2026 for release 0.7.0 (plan P10). Approved by Akmal on 9 November 2026 ("design approved"). Q1: yes, D2 as written. **Q2: yes, the account holder is emailed when a hold begins** (Akmal approved the new message kind), which this design adds to its build. It changes how sign-in is refused and adds a table, so it is designed first (CLAUDE.md).

PLAN §6 and TECHNICAL-PLAN §8.2 promise "lockout with backoff and an audit entry". Today there is a limit per caller address, held in each process's memory, and nothing per account for passwords.

## 0. What exists

Better Auth paths below are in the installed 1.7.14, under `node_modules/better-auth/dist`.

| Piece | Where | Today |
|---|---|---|
| The address limiter | `packages/core/src/auth/auth.ts:231-233`, `:393-418` | 10 a minute on `/sign-in/email`, `/sign-up/email`, `/two-factor/verify-totp` and `/two-factor/verify-backup-code`. 100 a minute on anything else no rule names. Counts every request, not only failures |
| The reset rule names a path that is gone | `auth.ts:416`; `api/rate-limiter/index.mjs:305-316` | The rule is for `/forget-password`. In 1.7.14 the endpoint is `/request-password-reset` (`apps/web/app/(auth)/forgot-password/page.tsx:28`), so Better Auth's own default applies: **3 a minute, not 5** |
| Where the count lives | `api/rate-limiter/index.mjs:6`, `:197` | A `Map` in each process. Two replicas allow twice the count. `rateLimit.customStorage` (one `consume(key, rule)`) is Better Auth's supported way to share it |
| A second factor | `plugins/two-factor/verify-two-factor.mjs:117-180`; `packages/db/src/schema/auth.ts:128-131` | **Already locked per account** by Better Auth: 10 failed codes in a row, across TOTP and backup codes, lock that factor for 15 minutes. On by default, the columns exist since migration 0004. Not set explicitly in `createAuth`, and not audited as such |
| The refusal's audit row | `apps/web/app/api/auth/[...all]/route.ts:36-55` | Every 429 writes `auth.rate_limited` (path, address) to the instance chain. It reads the address from the first `X-Forwarded-For` entry itself (`:40-43`), which `caller-address.ts` says must not be trusted |
| The caller's address | `packages/core/src/auth/caller-address.ts` | One answer for every per-address limit. Better Auth's `getIP` folds IPv6 to its /64 |
| Hook points Better Auth really offers | `api/dispatch.mjs:245-247`; `auth.ts:433`, `:451`; `api/routes/password.mjs:164` | `hooks.before` can refuse before the endpoint runs (SSO enforcement uses it). `hooks.after` runs with `context.returned` holding the endpoint's `APIError`. `databaseHooks.session.create` sees every sign-in by any factor. `emailAndPassword.onPasswordReset({ user })` runs after a reset |
| The sign-in endpoint | `api/routes/sign-in.mjs:316-336` | One error for an unknown address and a wrong password, and a dummy hash for an unknown address, so timing says nothing |
| The page | `apps/web/app/(auth)/sign-in/page.tsx:144-154`; `packages/ui/src/i18n/messages/en.json:1186` | Any 429 reads "Too many attempts. Wait a minute and try again." |
| The shared cache | `packages/adapters/src/drivers/cache/postgres.ts`; `apps/web/lib/cache.ts` | `rateLimit(key, limit, window)` on `cache_entries`, shared by every replica. Already counts the device, OAuth token and registration doors |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **A hold, not a lock.** After too many failures the next password attempt for that address is refused, without checking the password, until a time passes. It ends on its own. Nothing needs unlocking | A lock somebody must lift is a lock an attacker can set on a victim. A short, capped hold costs a guesser hours and a person minutes |
| D2 | **Two counters per attempt.** The *pair*: the address being signed in to with the caller's address. The *account*: the address being signed in to, from anywhere | The pair stops one source and never touches the person on another network. The account stops guessing spread over many sources |
| D3 | **The curve.** Hold = 1 minute × 2^(failures − threshold), capped at 15 minutes. Threshold 5 for the pair, 20 for the account. Failures count in a row since the last success; one more than 24 hours after the last resets the count to 1 | Five typos is generous for a person. One address then gets about 100 guesses a day, and so does the whole internet against one account. Against a 12-character minimum (`auth.ts:339`) that is enough |
| D4 | **A known address is never held by the account counter**, only by its own pair. Known: this address signed in to this account successfully in the last 30 days | The attacker who trips the account counter cannot hold the person at their usual desk |
| D5 | **Keyed hashes, never addresses.** Both keys are HMAC-SHA-256 under a key derived from `BETTER_AUTH_SECRET`: the trimmed, lower-cased email address, and the caller address from `callerAddress()`. Counted the same whether or not an account exists | A hold then says nothing about who has an account. A copy of the table names nobody. Rotating the secret forgets every count, which errs towards letting people in |
| D6 | **Counted first, forgiven on success.** A Better Auth plugin's `hooks.before` on `/sign-in/email`, after SSO enforcement, runs one upsert that adds a failure to both rows unless held and returns the hold. A held attempt is refused there | A burst of 50 parallel guesses is counted before any password is checked, so at most 5 are checked |
| D7 | **What clears both counters for an account**: a session created for its user by any factor (`databaseHooks.session.create.after`, which also stamps the pair as known); a completed reset (`onPasswordReset`); an `EMAIL_NOT_VERIFIED` answer, which Better Auth gives only after the password matched. Time ends a hold. There is no manual unlock | The longest wait is 15 minutes and a reset clears it at once. A workspace admin may not touch an instance-level account anyway |
| D8 | **Never counted and never held**: passkeys, single sign-on, reset requests and sign-up | A passkey assertion cannot be guessed and the identity provider runs its own lockout. These are the ways round a hold, so a hold must not close them. The address limiter still covers their endpoints |
| D9 | **The second factor keeps Better Auth's lock**, now set explicitly: `accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 }` | Only somebody who already knows the password reaches it. Explicit, so an upgrade that changes the default shows in a diff |
| D10 | **Replicas share everything through Postgres.** The counters are one row each, changed by one atomic statement. The address limiter moves to `rateLimit.customStorage` built on the Postgres cache port, passed in by `apps/web/lib/auth.ts`. Server calls to `auth.api` skip the router, so this costs a query only on real sign-in traffic | Postgres is the only required service. No in-process state is left to disagree |
| D11 | **The reset rule is fixed** to `/request-password-reset`, 5 a minute, and the dead `/forget-password` entry leaves `CREDENTIAL_PATHS` | The code meant 5 and has been getting 3 |
| D12 | **The answer to a held attempt**: 429, `Retry-After` in seconds, code `SIGN_IN_HELD`, "Too many attempts for this address. Try again in N minutes, or reset your password." The page shows the minutes and links to the reset page | UIUX-PLAN S-35 asks for clear lockout messaging. Same words for every address |
| D13 | **Audit, bounded.** `auth.sign_in_held` on the instance chain when an account hold begins on an address that has an account: `{ userId, failures, holdSeconds }`. `auth.second_factor_locked { userId }` when Better Auth's lock begins. Pair holds are counted by `openokr_sign_in_held_total{scope}` instead. The route wrapper keeps `auth.rate_limited` for the address limiter's own 429 (the only one carrying `X-Retry-After`) and reads the address through `callerAddress()` | The instance chain appends under one lock (`instance-chain.ts`). One row per hold per real account is bounded; one per refusal, or per random address sprayed, is not |
| D14 | **Not a setting.** The numbers are constants in `packages/core/src/auth/lockout.ts`, like the limiter's today. `createAuth` takes `lockout?: { enabled }` for tests, like `rateLimit` | A security floor nobody should have to choose. Nothing in §4.14 to default |
| D15 | **Written outside the Operation pipeline**, like Better Auth's own rows, with an `openokr:allow-mutation` comment saying so | A sign-in attempt has no workspace and no actor, which the pipeline needs |
| D16 | **A daily purge** on the scheduler host, beside `outbox.purge`, deletes rows nobody touched for 30 days | Spraying random addresses makes rows. Thirty days is the known-address window |

## 2. The table

Migration `0151_sign_in_attempts.sql` (the next free number today), forward-only, additive.

| Column | Type | Notes |
|---|---|---|
| `account_key` | `text`, not null | HMAC of the email address |
| `caller_key` | `text`, not null | HMAC of the caller address. Empty on the account row |
| `failures` | `integer`, not null, default 0 | In a row, within 24 hours |
| `last_failure_at` | `timestamptz` | |
| `held_until` | `timestamptz` | When the next attempt is checked |
| `last_success_at` | `timestamptz` | Pair rows only. What makes an address known |
| `created_at`, `updated_at` | `timestamptz`, not null | `updated_at` indexed for the purge |

Primary key `(account_key, caller_key)`. Marked `openokr:not-tenant-scoped` and `openokr:hard-delete`, with reasons, exactly as `users`, `verifications` and `two_factors` are in migration 0004: it is a global identity's state, read before any workspace exists, so a tenant policy would answer zero rows; a cleared counter must be gone. Not `openokr:instance-scope`: that pattern writes under `app.instance_admin`, and setting the instance-admin key on every sign-in attempt would make it mean nothing. The default grants in `packages/db/src/grants.ts:53` give the application role what it needs.

## 3. What somebody sees

| Situation | Answer |
|---|---|
| Five wrong passwords from one network | A 1 minute hold, then 2, 4, 8, 15. Elsewhere the person signs in normally |
| An attacker on many networks makes 20 failures | New networks are held. The person's known network is not. A passkey, single sign-on and a reset still work |
| The right password during a hold | Refused with the wait. The page offers a reset, which clears it |
| A passkey or SSO sign-in | Never held. It clears every counter for the account |
| A wrong second-factor code ten times | Better Auth holds that factor for 15 minutes. One audit row |

**Q1, for you.** D2's account counter means an attacker with several networks can keep password sign-in held for one account from any network the person has not used in 30 days, for as long as they keep trying and 15 minutes after. Passkeys, single sign-on and a reset stay open. The alternative is no account counter, which leaves guessing spread over many addresses limited only per address. A CAPTCHA would need a new dependency and an outside service, which an air-gapped install cannot have. **Proposed: D2 as written.**

**Q2, for you.** Should the account holder get an email when an account hold begins ("somebody is trying your password")? It is a new kind of message, so it is yours to decide. **Proposed: not in 0.7.0.** The audit row and the metric carry it, and with the console mail transport the notice would only reach the server log.

## 4. Acceptance criteria

- Given an account, when one address sends five wrong passwords, then the sixth attempt within a minute gets 429 with `Retry-After` and code `SIGN_IN_HELD`, and its password is not checked.
- Given that hold, when the same account signs in from another address with the right password, then it succeeds.
- Given an address with no account, when it is tried five times, then the sixth answer is identical to the one an existing account gets.
- Given 20 failures for one account from 20 addresses, when a 21st address tries, then it is held; and when an address that signed in to the account last week tries the right password, then it succeeds.
- Given a held account, when the person completes a password reset, then the next sign-in from the held address is checked at once.
- Given a held account, when the person signs in with a passkey, then it succeeds and both counters are cleared.
- Given two application processes, when one address sends three wrong passwords to each, then the sixth attempt overall is held.
- Given 50 parallel wrong attempts from one address, then at most five reach the password check.
- Given an account hold beginning on a real account, then exactly one `auth.sign_in_held` row is appended, with no email address and no caller address in it.
- Given a held attempt, then no `auth.rate_limited` row is written; given the address limiter's own 429, then one is, with the address `callerAddress()` gives.
- Given a request to `/request-password-reset`, then the sixth within a minute from one address is refused.
- Given a row untouched for 31 days, when the daily purge runs, then it is gone.

## 5. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/lockout-curve.test.ts` | The curve, the cap, the 24-hour reset, the two thresholds |
| Integration | `packages/core/test/sign-in-lockout.test.ts` | Pair and account holds, known address, unknown address answers alike, every clearing path, passkey and SSO never held, the parallel burst |
| Integration | `packages/core/test/auth-rate-limit-shared.test.ts` | Two `createAuth` instances on one database share the address count; the reset rule's path |
| Integration | `packages/core/test/second-factor-lock.test.ts` | The explicit options, and one audit row when the lock begins |
| Unit | `apps/web/test/auth-route.test.ts` (existing) | `auth.rate_limited` only for the limiter's 429, address through `callerAddress()` |
| Integration | `packages/db` migration suite and `pnpm db:lint` | Markers, primary key, purge index |
| End to end | `e2e/s35-sign-in-hold.spec.ts` | Five wrong passwords, the sixth shows the wait and the reset link |

## 6. Documents changed in the same change

- TECHNICAL-PLAN §4.1: a `sign_in_attempts` row. §8.2 Brute force: what is counted, the curve, what is never held. §4.14: nothing, by D14.
- TECHNICAL-PLAN §7.2: `sign_in_attempts` joins the `No legacy source` row with `accounts`, `sessions` and `two_factors`.
- DATABASE.md §4: the table. §1: it joins the authentication tables excepted from `workspace_id`.
- UIUX-PLAN S-35: the held message names the wait and offers a reset.
- `docs/admin/security.md`: a "Sign-in protection" section with the curve and what clears a hold.
- The English and Malay message files, and a changeset.

## 7. What this does not do

- No CAPTCHA, no device fingerprint and no trusted-device cookie.
- No count on password checks behind a signed-in session (change password, enabling a second factor). The address limiter covers them, and a session must exist first.
- No screen or command to lift a hold.
- No per-user limits on the API, channels or exports, which §8.2 also lists. Tokens are not passwords.
- `auth.rate_limited` still writes one row per limiter refusal. Bounding it is a separate change.
