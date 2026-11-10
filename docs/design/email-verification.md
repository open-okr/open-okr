# Email verification: the outbox and "send the link again"

Status: **draft, waiting for Akmal's "design approved"**. Plan 0.8.0 row S3, which carries row H1 (`docs/plans/release-0.8.0.md` §3.1 and §8). Gate: design first, because it changes authentication and could be used to find out who has an account (CLAUDE.md). No migration and no new table.

S1 (the check-your-email card) and S2 (the page a link lands on) are being built in this worktree without a design. This document builds on what they do: S1 keeps the address in the form's own state and reads the link's lifetime from `EMAIL_VERIFICATION_LINK_SECONDS` in `packages/core/src/auth/auth.ts`; S2 is the signed-out page `/email-confirmed` (not `/welcome`, which is onboarding, S-34), named as Better Auth's `callbackURL` by the sign-up form.

Better Auth paths below are in the installed 1.7.18, under `node_modules/better-auth/dist` unless named otherwise.

## 0. What exists

A link has to be confirmed only where mail can arrive: `resolveRequireEmailVerification` (`packages/core/src/auth/signup-policy.ts`) answers true when `mail.transport` is `smtp`, once, at boot. With the console transport nothing below happens and sign-up signs the person in.

| Step | Today | Where |
|---|---|---|
| Sign-up writes the account | The user row and the password row are written one statement at a time. **There is no transaction**: OpenOKR's Drizzle adapter is built without `transaction`, which defaults to off, so Better Auth's `runWithTransaction` runs the work directly and nothing can roll back | `drizzleAdapter(...)` in `createAuth`; `@better-auth/drizzle-adapter` `dist/index.mjs:565`; `@better-auth/core` `dist/context/transaction.mjs:60-63` |
| Sign-up sends the mail | Better Auth mints a signed token (a JWT, never stored) and calls `emailVerification.sendVerificationEmail`. OpenOKR's callback calls the web app's sender, which sends through SMTP **inside the request**. The person waits for the mail server | `api/routes/sign-up.mjs:241-250`; `createAuth` `emailVerification`; `apps/web/lib/auth.ts` `buildAuth` (`sendVerificationEmail`, then `sendMail`) |
| The mail server refuses | Better Auth's `runInBackgroundOrAwait` catches the error and logs "Failed to run background task". Sign-up answers success anyway. **No retry, and no record outside the process log** | `context/create-context.mjs:215-225` |
| The mail | Built by `verifyEmailMail` in the instance's language. It does not say how long the link works. Its footer says "Did not sign up? Ignore this email and no account is created", which is false: the account exists, unconfirmed | `apps/web/lib/account-mail.ts`; `packages/core/src/mail/words.ts:33-41`, Malay `:182-189` |
| The link | Lasts one hour: Better Auth's default, now named `EMAIL_VERIFICATION_LINK_SECONDS = 60 * 60` by S1. It confirms the address and signs nobody in (`autoSignInAfterVerification` is off). It is bound to the account's id and address. A newer link does not cancel an older one | `createEmailVerificationToken` in `api/routes/email-verification.mjs:14-20`; `verifyEmail` `:125-314` |
| Sign-in before confirming | "Confirm your email address first. Open the link we sent you, then sign in." Better Auth says this only after the password matched | `api/routes/sign-in.mjs:338-350`; `apps/web/app/(auth)/sign-in/page.tsx` (`EMAIL_NOT_VERIFIED`) |
| Signing up again | With verification required, Better Auth answers a repeat with a **generic success**: a made-up user and no session, so it cannot be used to find out who has an account. Nothing is sent | `api/routes/sign-up.mjs:155`, `:192-203` |
| Asking for a new link | **No page offers it.** Better Auth's own `POST /api/auth/send-verification-email` is reachable through the catch-all today, limited by Better Auth's default rule of 3 a minute per caller address, counted in each process | `apps/web/app/api/auth/[...all]/route.ts`; `api/rate-limiter/index.mjs:305-320` |
| Resetting the password | Sets a new password and leaves the address unconfirmed, so sign-in still refuses. A reset does not end other sessions | `api/routes/password.mjs:129-166`; `utils/password.mjs:31-46` (`revokeSessionsOnPasswordReset` not set) |

So an account whose first mail never arrived is stuck: no page offers a link, a repeat sign-up sends nothing, and a reset does not confirm.

### 0.1 Where the plan's description differs from the code

| Plan says | The code says |
|---|---|
| H1: "when the mail server refuses it the person sees an error" | On Better Auth 1.7.14 and 1.7.18 a refused mail does not fail sign-up: `runInBackgroundOrAwait` swallows it. The old form then sent the person to `/`, which bounced them to sign-in with no word. What OKRGoal's person saw cannot be read from the code. The account ends stuck either way |
| H1: "Signing up again says the address is taken" | With verification required, a repeat sign-up answers the generic success above. `USER_ALREADY_EXISTS` is answered only where verification is not required. With S1 built, a repeat now shows "Check your email" although nothing was sent |
| H1: "nothing offers the link again" | True of the pages. The endpoint already exists and answers |
| H1 and S3: the mail "goes through the outbox" in the sign-up's transaction | There is no sign-up transaction to join (first row above). D2 says what is done instead |
| S2: a page "such as `/welcome`" | S2 is built at `/email-confirmed`; `/welcome` is onboarding |
| S2's words for a broken link: "replaced by a newer link" | A newer link replaces nothing. Every link works until it expires (§4) |
| `DATABASE.md`: `verifications` holds "email verification and password reset challenges" | Only reset challenges. A confirmation link is a signed token and is never stored |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The confirmation mail goes through the outbox.** OpenOKR's `sendVerificationEmail` callback in `createAuth` inserts one row on topic `account.verifyEmail` with `enqueueOutbox` and returns. The relay sends it. Sign-up never waits on a mail server, and a refused mail is retried | H1. The relay already retries, dead-letters and counts every other mail |
| D2 | **The row is its own one-statement transaction, on the pool.** Not a new Better Auth setting, not an Operation | The user row is Better Auth's write, outside the Operation pipeline by design, and is committed before the callback runs. Turning on the adapter's transactions would not help: the callback is handed no transaction handle. The one gap left, an account with no queued row because the insert failed, is exactly the state D7's link recovers, so it needs no atomicity |
| D3 | **The callback never throws.** A failed insert is logged and counted, and the request answers as if the row were queued | Better Auth's resend rethrows a callback error after its timing floor, and only for an unconfirmed account (`email-verification.mjs:110-117`). An error there would tell a stranger the account exists |
| D4 | **The row carries the link Better Auth built**: `{ userId, to, url, expiresAt, reason }`, `reason` one of `sign_up`, `resend`, `repeat_sign_up`. Idempotency key `account.verifyEmail:<sha256 of the token>`, so the same link is never queued twice. `to` and `url` join `OUTBOX_REDACT_ON_DELIVERY`, as `invitation.email`'s address and token do | Minting the token at delivery instead would need `BETTER_AUTH_SECRET` in whatever process drains the outbox, which H10's worker and O3's job show is easy to miss. The relay's default retries end in about 15 minutes, far inside the link's life |
| D5 | **The handler checks before it sends** (`packages/core/src/outbox/handlers.ts`, modelled on `sendInvitation`). Skipped, not failed: no mail configured; `expiresAt` passed; the account gone; already confirmed; its address changed. Otherwise it builds the mail in the instance's language and sends it. The relay's default policy applies (10 attempts, backoff to 5 minutes), then the row is dead-lettered and counted in `openokr_outbox_dead_lettered_total` | A link nobody can use is not worth a mail. A refusal that lasts, like a mail service in its sandbox, is not cured by a day of retries; the person asks again (D7) once the operator fixes it |
| D6 | **The mail is built in `packages/core`.** `verifyEmailMail` moves from `apps/web/lib/account-mail.ts` to `packages/core/src/mail/`, beside the invitation mail. The web app stops passing `sendVerificationEmail` to `createAuth`; `requireEmailVerification` alone decides whether anything is queued | The relay's handlers live in `packages/core` and may not import `apps/web`. The reset and held-sign-in mails stay where they are (§9) |
| D7 | **The resend is Better Auth's own `POST /api/auth/send-verification-email`**, body `{ email, callbackURL: "/email-confirmed" }`, through the client's `authClient.sendVerificationEmail`. No new route and no registry action | It already answers `{ "status": true }` for an unknown, a confirmed and an unconfirmed address alike, after a 500 ms floor (`email-verification.mjs:99-118`). It mints the same token sign-up does. A registry action needs a workspace and an actor, and a signed-out person has neither. Better Auth checks `callbackURL` against the instance's own origin |
| D8 | **Offered in three places**: S1's check-your-email card, S2's expired and invalid states, and beside "Confirm your email first" on sign-in (§3). Not Better Auth's `sendOnSignIn` | `sendOnSignIn` would send a link on every attempt with the right password, unasked, and its link would carry the sign-in's `callbackURL`, which is also where a successful sign-in redirects |
| D9 | **Per address: one a minute and five a day.** Counted on every request for the address, whether or not it has an account, before Better Auth looks it up, in a `hooks.before` branch for `/send-verification-email` in `createAuth`. The key is an HMAC-SHA-256 of the trimmed, lower-cased address under a key derived from `BETTER_AUTH_SECRET`, as `lockout.ts` keys its counters, kept through `rateLimitStorage` so every replica shares it. Over the limit: 429, code `VERIFICATION_RESEND_HELD`, `Retry-After` in seconds (in the body too, as `SIGN_IN_HELD` does), and the words in §3. A repeat sign-up's link (D12) draws on the same allowance and is silently not queued when it is spent | Stops anybody flooding one inbox from many networks. Counting every address alike means a refusal says nothing about who has an account. A copy of the cache table names nobody |
| D10 | **Per network: five a minute**, by adding `/send-verification-email` to `LIMIT_RULES`, so the count moves to Postgres and every replica shares it (account-lockout.md D10). Today it is Better Auth's default 3 a minute, in each process. The route's existing `auth.rate_limited` row covers this refusal. **Until H2 lands**, every caller behind a CDN and a load balancer resolves to one shared address, so this becomes five a minute for the whole instance; the per-address limit is unaffected, and OKRGoal's per-visitor rule at Cloudflare keeps holding it off. Once H2 lands, the same rule is per network with no change here | Five matches the reset request (account-lockout.md D11) and leaves room for an office behind one address |
| D11 | **The numbers are constants** in `packages/core/src/auth/`, not settings. Nothing goes in METHOD.md (it holds OKR practice) or in TECHNICAL-PLAN §4.14 | The same call as account-lockout.md D14: a security floor nobody should have to choose. Q1 offers the lifetime as a setting instead |
| D12 | **A repeat sign-up of an unconfirmed address queues a fresh link**, through Better Auth's `emailAndPassword.onExistingUserSignUp`, which calls the resend server-side without waiting for it. **A repeat of a confirmed address sends nothing** (Q3). The sign-up's answer is unchanged | Makes S1's "we have sent a link" true for the person who signed up, never got the mail and tried again, which is what a stuck person does first. Not awaited, so a repeat takes no longer for having an account |
| D13 | **The link lasts 24 hours** (Q1): `EMAIL_VERIFICATION_LINK_SECONDS = 24 * 60 * 60`. S1's card, S2's expired state, the resend's answer and the mail all read it | Mail can sit in a company's filters for longer than an hour, and people sign up at the end of a day. The link only confirms an address and signs nobody in. A week would leave a forwarded mail useful for too long, and a signed token cannot be cancelled one at a time |
| D14 | **A completed password reset confirms the address**, in `emailAndPassword.onPasswordReset`, through Better Auth's own adapter (`$context.internalAdapter.updateUser`), so its user-update hooks run. Never a direct SQL update | The reset link reached the mailbox, which is the same proof a confirmation link gives. It gives a stuck account a second way out through a page that exists, and lets the real owner of a pre-registered address take it with their own password (§4) |
| D15 | **A completed reset ends every session of the account** (`revokeSessionsOnPasswordReset: true`) | The second half of D14's defence: somebody who pre-registered an address and signed in is signed out the moment the owner resets. It changes every reset: other devices are signed out, which is what people expect of a reset |
| D16 | **Accounts already stuck, such as the three on OKRGoal, need no data change and no command.** Once 0.8.0 runs, each can sign in and press "Send the link again", sign up again (D12), or reset the password (D14). Their old links expired long ago. The operator may write to them once the upgrade is live | Nothing stored is wrong; only a way out was missing. Changing stored user data is a decision this design does not need |
| D17 | **Audit, bounded.** `auth.email_verified { userId, via: "link" \| "reset" }` on the instance chain when an address is confirmed: by a link through Better Auth's `emailVerification.afterEmailVerification`, by a reset through D14. Once per account. No row per link queued and no row per D9 refusal | Confirming an address is what trusted-domain joining relies on, so it is the event worth a permanent record. One row per request, or per address sprayed, would not be bounded. The outbox row (`userId`, `reason`, delivered or dead-lettered with its error) is the record of each link for `outbox.retentionDays`, and `openokr_verification_links_total{reason, outcome}` counts queued and refused |
| D18 | **The mail tells the truth.** A notice line, "The link works for 24 hours." The footer becomes "Did not sign up? Ignore this email. Nothing is confirmed unless the link is opened." English and Malay | The current footer says no account is created, which is false, and the mail never says how long the link lasts |

### 1.1 How a link travels

| # | Step | Where |
|---|---|---|
| 1 | Sign-up, a resend or a repeat sign-up reaches Better Auth | `/api/auth/sign-up/email`, `/api/auth/send-verification-email` |
| 2 | Better Auth's limiter counts the network (D10). For a resend, OpenOKR's `hooks.before` counts the address (D9) | `createAuth` `rateLimit.customRules`, `hooks.before` |
| 3 | Better Auth decides: unknown or confirmed, nothing; unconfirmed, it mints the token and calls back | `email-verification.mjs:107-113` |
| 4 | The callback inserts one `account.verifyEmail` row and returns (D1 to D4) | `createAuth` `emailVerification.sendVerificationEmail` |
| 5 | The answer goes back: S1's card, or `{ "status": true }` after at least 500 ms | |
| 6 | The relay claims the row, usually within a second, checks it (D5), sends the mail and strips `to` and `url` | `apps/web/lib/relay.ts`, `packages/adapters/src/relay.ts` `#markDelivered` |
| 7 | The person opens the link. Better Auth confirms and redirects to `/email-confirmed`, or adds `?error=` there. `auth.email_verified` is appended | `verifyEmail`; `afterEmailVerification` |

**What keeps the boundary rule intact.** The write-path rule in `packages/config/src/boundaries.ts` fails a direct `.send(` on a write path. After this change the verification mail has no direct send left: the callback only calls `enqueueOutbox`, and the send happens in `packages/core/src/outbox/`, which the rule treats as the delivery side. The callback's `openokr:allow-side-effect` comment goes, replaced by one saying why its row is not inside a domain transaction. The marked send in `apps/web/lib/mail.ts` keeps two callers, the reset and the held-sign-in notice, and its comment is corrected to name both.

## 2. Where the numbers live

| Number | Value | Home |
|---|---|---|
| Link lifetime | 24 hours | `EMAIL_VERIFICATION_LINK_SECONDS`, `packages/core/src/auth/auth.ts` (exists, value changes) |
| Per address | 1 a minute, 5 a day | New constants beside the D9 hook in `packages/core/src/auth/` |
| Per network | 5 a minute | `LIMIT_RULES` in `auth.ts` |
| Timing floor | 500 ms | Better Auth's own, `email-verification.mjs:105` |
| Retries | 10 attempts, backoff to 5 minutes | The relay's defaults, `packages/adapters/src/relay.ts:218`, `:247-248`. No entry in `OUTBOX_RETRY_POLICY` |

## 3. What somebody sees

Every resend button is the kit's `Button`; the address on S2 is the kit's `EmailInput`. The answer sentence sits in a polite live region. After a press the button is replaced by the answer and comes back 60 seconds later. Pressing shows "Sending..." on the button.

| Surface | State | What the reader sees |
|---|---|---|
| S1, check your email | As S1 builds it | "Your account is created. We have sent a link to **name@example.com**." How long it works, the spam hint, Back to sign in. **New**: a secondary "Send the link again" |
| S1 | Pressed, accepted | "If **name@example.com** has an account waiting to be confirmed, a new link is on its way. It works for 24 hours." |
| S2, `/email-confirmed?error=TOKEN_EXPIRED` | Expired | "This link has expired". "A link to confirm an email works for 24 hours, and this one has run out." **New**: "Type your email and we will send a new one.", an email field, "Send a new link". The support line stays below as "Still stuck? Write to ..." |
| S2, any other error | Not valid | "This link is not valid". "It may have been copied only in part." (S2's "or replaced by a newer link" goes.) The same form |
| S2 | Pressed, accepted | The S1 sentence, then "Already confirmed? Sign in." with the link |
| Sign-in | `EMAIL_NOT_VERIFIED` | "Confirm your email address first. Open the link we sent you, then sign in." **New**: "Send the link again", for the address in the form |
| Sign-in | Pressed, accepted | "A new link is on its way to **name@example.com**. It works for 24 hours." Direct, because Better Auth said the address is unconfirmed only after its password matched |
| Any | Per address, 429 `VERIFICATION_RESEND_HELD` | "Too many links have been asked for this address. Try again in 1 minute." (or "in N minutes", "in N hours") |
| Any | Per network, the limiter's 429 | "Too many attempts. Wait a minute and try again." (`auth.signIn.tooManyAttempts`, unchanged) |
| Any | Anything else | "That did not work. Try again in a moment." |
| The mail | | As today, plus D18's notice and footer |

## 4. Security

| Concern | What happens |
|---|---|
| Finding out who has an account, by the answer | The resend answers 200 `{ "status": true }` for every address. The pages say "if ... has an account waiting to be confirmed". A repeat sign-up keeps Better Auth's generic success, and D12 changes nothing in it |
| By timing | Better Auth holds every unsigned-in answer to at least 500 ms. The slow branch is now one insert, well inside it. D3 keeps an insert failure from turning into an error only an unconfirmed account would get. D9's count runs for every address before the lookup |
| By the limits | D9 counts every address the same, so its 429 is the same for all. D10 counts networks, not addresses |
| Flooding somebody's inbox | Only an unconfirmed account is ever sent a link. At most one a minute and five a day per address, whatever the network, and five requests a minute per network. A confirmed address is never sent anything by the resend |
| A link for an already confirmed address | The resend sends none. An old link opened again lands on the welcome with no error. It signs nobody in |
| Old links stay valid | A token is signed, not stored, so a new link does not cancel the old ones. Every link stops at 24 hours. Rotating `BETTER_AUTH_SECRET` cancels them all |
| A leaked link | It confirms the address it was sent to and nothing else: no session, and it is bound to the account's id and address |
| The link at rest | In the outbox row until it is delivered, then stripped in the same statement that marks it delivered. A dead-lettered row keeps it until the daily purge (`outbox.retentionDays`, 30 by default), by which time the link has expired |
| **Pre-registration** | Somebody who knows a person's address signs up with it first and a password of their own. The account waits unconfirmed. When the real person later signs up, they get the generic success, and a link (D12 or the button). Opening it confirms an account whose password the first person chose. From then until the real person resets, the first person can sign in as a confirmed address, which is what trusted-domain joining trusts. Today the same attack only locks the real person out. D14 lets the owner take the address back with their own password, and D15 signs the first person out when they do. **Q2 asks whether that is enough** |
| Single sign-on enforcement | The resend is not refused for an enforced domain. Confirming an address gives no way round enforcement, because sign-in is still refused there |
| Where the link lands | The pages pass a fixed path. Better Auth checks `callbackURL` against the instance's origin on both the resend and the link |

## 5. Acceptance criteria

- Given an instance whose mail transport is SMTP, when somebody signs up, then exactly one `account.verifyEmail` row is queued, no mail is sent inside the request, and the answer is the one S1 reads today.
- Given a mail server that refuses every message, when somebody signs up, then sign-up succeeds and S1's card shows, and the row is retried and then dead-lettered with the server's error.
- Given the outbox insert fails, when somebody signs up or asks for a link, then the answer is unchanged and the failure is logged and counted.
- Given an unconfirmed account, when its address is posted to `/api/auth/send-verification-email`, then the answer is 200 `{ "status": true }`, one row is queued, and the mail's link opens `/email-confirmed` confirmed.
- Given an address with no account and a confirmed account, when each is posted, then each answer has the same status and body as above, takes at least 500 ms, and queues nothing.
- Given an address asked for once, when it is asked for again within a minute, then the answer is 429 `VERIFICATION_RESEND_HELD` with the wait, and it is the same whether or not the address has an account.
- Given five links asked for one address today, when a sixth is asked for from another network, then it is refused with the hours to wait.
- Given two application processes, when one network asks six times within a minute across both, then the sixth gets the limiter's 429 and one `auth.rate_limited` row.
- Given a queued row whose account was confirmed before delivery, when the relay delivers it, then no mail is sent and the row is marked delivered.
- Given a queued row whose `expiresAt` has passed, when the relay delivers it, then no mail is sent.
- Given a delivered or skipped row, then its payload holds neither `to` nor `url`.
- Given a link, when it is opened after 24 hours, then the expired state shows with the form; when it is opened within 24 hours, then the address is confirmed and exactly one `auth.email_verified { userId, via: "link" }` row is appended.
- Given two links for one account, when the older is opened after the newer, then the welcome shows with no error.
- Given an unconfirmed account, when somebody signs up again with its address, then the answer is Better Auth's generic success and one fresh link is queued; given a confirmed account, then nothing is queued.
- Given an unconfirmed account, when its holder completes a password reset, then the address is confirmed, one `auth.email_verified { userId, via: "reset" }` row is appended, and the next sign-in with the new password succeeds.
- Given an account signed in on two devices, when a password reset completes, then both sessions end.
- Given the console mail transport, when somebody signs up, then nothing is queued and they are signed in; when the resend is posted, then it answers 200 and queues nothing.
- Given the right password for an unconfirmed account, when the person presses "Send the link again" on sign-in, then they read "A new link is on its way to" their address.
- Given the mail, then it says the link works for 24 hours, in the instance's language, and its footer no longer says no account is created.

## 6. Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/email-verification.test.ts` (new) | `createAuth` with verification required: one row per sign-up and no send; an insert failure answers success; resend parity of status, body and the 500 ms floor; D9 and D10; D12 both ways; D14, D15 and the audit rows |
| Unit | `packages/core/src/outbox/handlers.test.ts` (existing) | The handler's skips and send, and the topic's redaction list |
| Unit | The mail builder's test, moved with it from `apps/web/test/account-mail.test.ts` | Lifetime line and footer, English and Malay |
| Unit | `apps/web/test/auth-route.test.ts` (existing) | `auth.rate_limited` for the new rule's 429 |
| End to end | `e2e/s35f-email-confirmed.spec.ts` (S2's, extended) | The expired state's form shows the neutral sentence, and a second press within a minute shows the wait. The suite's instance writes mail to its log, so it requires no confirmation; the sign-in and S1 buttons are covered by the integration suite and by hand on staging with SMTP |

## 7. Questions for Akmal

**Q1. How long does a link work, and is it a setting?**

| Option | For | Against |
|---|---|---|
| One hour, as today | Smallest window for a forwarded mail | Too short for mail held in a company's filters or read the next morning; the main reason people will press "send the link again" |
| **24 hours, a constant** | Covers a working day and slow mail. One number in one place | An operator cannot change it |
| 24 hours by default, as an instance setting in §4.14 | An operator with very slow mail can lengthen it | A security number to explain on a settings card that almost nobody needs |
| Seven days | Fewest resends | A leaked or forwarded link stays useful for a week |

**Recommended: 24 hours, as a constant.**

**Q2. Who may ask for a new link, given pre-registration (§4)?**

| Option | For | Against |
|---|---|---|
| **(a) Anybody who types the address, as the plan says, with D14 and D15** | Works on all three surfaces exactly as S1 and S2 are built. The owner ends a pre-registration with one reset, which also signs the intruder out | From the moment the owner opens the link until they reset, the intruder holds a confirmed account and could accept a trusted-domain offer |
| (b) Only somebody who knows the password | Nobody can confirm an account whose password they did not choose. Built on Better Auth's `sendOnSignIn` | S1 must keep the typed password in memory to resend; S2 can only say "sign in to get a new link"; every sign-in attempt by an unconfirmed account sends a mail; and the link's landing page has to be rewritten into Better Auth's URL, because `sendOnSignIn` uses the sign-in's own `callbackURL` |

**Recommended: (a).** The attack needs somebody to know in advance who will sign up, act first, and then win a race the owner ends with one reset. D14 and D15 are worth having under (b) too.

**Q3. Should a repeat sign-up of a confirmed address email its holder?** S1's card says a link was sent, and for a confirmed address nothing is.

| Option | For | Against |
|---|---|---|
| **No, not in 0.8.0** | No new kind of message. S2's "Already confirmed? Sign in." and the card's Back to sign in cover a person who forgot they had an account | The card's "we have sent a link" is untrue for them |
| Yes: "You already have an account. Sign in, or reset your password." | The card's words become true for everybody | A new message kind, which is yours to decide, and one more mail an outsider can cause, within D9's allowance |

**Recommended: no.**

## 8. What the specification gains

| Page | Change |
|---|---|
| TECHNICAL-PLAN §8.2 | A row, "Email confirmation": required only where mail can arrive; a signed link that works for 24 hours and signs nobody in; sent through the outbox; the resend endpoint, its answer and its two limits; a completed reset confirms the address and ends every session; `auth.email_verified` |
| TECHNICAL-PLAN §5, the outbox contract | The `account.verifyEmail` topic, its redaction, and why its row is written outside a domain transaction |
| TECHNICAL-PLAN §4.14 | Nothing, by D11, unless Q1 chooses a setting |
| UIUX-PLAN §6, S-35 | "Send the link again" on the check-your-email card, the link's expired and invalid states, and sign-in, with the words in §3 |
| `DATABASE.md` | `verifications` holds reset challenges only; a confirmation link is never stored |
| `docs/design/email-templates.md` §5 | The confirmation mail is built in `packages/core` and sent by the relay, with its lifetime line and corrected footer |
| `docs/admin/security.md` | "Confirming email addresses": when it is required, how long a link works, the limits, what a person whose mail failed does, and the H2 note for an instance behind a CDN |
| English and Malay message files, `packages/core/src/mail/words.ts` | §3's words and D18's lines |
| The plan, §12 | S3 and H1 marked built; a changeset |

## 9. What this does not do

- The reset mail and the held-sign-in notice stay direct sends from the request, behind the marker in `apps/web/lib/mail.ts`. Better Auth already swallows their failures the same way; moving them to the outbox is a separate change.
- No expiry or deletion of accounts that are never confirmed.
- No operator command to send somebody a link.
- No CAPTCHA, which would need an outside service an air-gapped instance cannot reach.
- No change to how the caller's address is read. That is H2.
- No change to Better Auth's change-of-email flow, which OpenOKR does not enable.
- `auth.rate_limited` still writes one row per limiter refusal, as account-lockout.md §7 notes.
