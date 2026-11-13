# A setup code to claim a new instance

Status: **approved by Agung on 13 November 2026** ("design approved"), with Q1 to Q3 as recommended. Plan 0.9.0 row G1. Akmal approved the direction on 12 November 2026 (plan §10, "Design directions"). This document fills in the mechanism from that direction. Section 9 lists what the direction did not settle. A new security mechanism, so it is designed before code (CLAUDE.md).

## 1. The problem

| Today | Evidence |
|---|---|
| The first person to reach `/setup` creates the owner account and owns the instance | `registration-policy.md` §10 D17 and D18: "Whoever reaches an unclaimed instance first claims it" |
| A new hostname is public within minutes | Certificate transparency logs publish every certificate Caddy or cert-manager requests |
| OKRGoal kept new instances behind Cloudflare until claimed for this reason | Plan 0.9.0 row G1 |
| A code was named and deferred | `registration-policy.md` H3-Q1: "not in 0.8.0; a row for a later release" |

After this change, only someone who can read the deployment's secrets can claim an instance.

## 2. What changes for whom

| Who | Before | After |
|---|---|---|
| Operator, Compose (`./openokr up`) | Opens the address, creates the owner | `up` prints the code and writes it to `secrets/app.env`. The wizard asks for it on the account step |
| Operator, Helm | Same | The chart's Secret holds the code. The install notes say how to read it (first install only, with H1) |
| Operator, bare `docker run` with no code set | Same | The server makes a code at first boot and writes it to a file on the storage volume. The wizard names the file |
| Somebody who found the hostname | Can claim it | Cannot create the first account without the code |
| An instance already claimed | | Unaffected. The code is never asked for again |
| Sign-ups on a cloud instance after its claim | | Unaffected |
| Demo reset, staging seed, end-to-end suite, smoke test, cluster test | Claim with one sign-up request | Same request, with the code in a header, read from the secrets they already read |

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The code comes from the deployment, like every other secret.** `OPENOKR_SETUP_CODE` in the server's environment. `./openokr up` generates it with the other secrets, writes it to `secrets/app.env` and prints it. The chart generates it into its Secret through `openokr.keepSecret`, so it survives upgrades | The direction. Whoever can read the secrets deployed the instance |
| D2 | **With no `OPENOKR_SETUP_CODE`, the server makes one at first boot**, only while the instance is unclaimed. It stores only an HMAC of it (D5) in `system_settings` under `setup.codeHash`, inserted with `on conflict do nothing`. Only the process whose insert won writes the file, so a web and a worker process booting together cannot leave a file that does not match | The direction. A bare `docker run` has no secrets file |
| D3 | **The file is `<OPENOKR_STORAGE_ROOT>/setup-code`**, mode 600, deleted when setup finishes. Written to the local root whatever the storage driver, because the root exists in every container. The wizard names the path, and the command to read it (`docker exec <container> cat /app/storage/setup-code`) | The direction says "the storage volume". With S3 the local root is not a volume, but it outlives the claim, which is all the code needs. See Q1 |
| D4 | **Never logged.** Not at boot, not on a wrong attempt, not in the audit row. The boot log says only "A setup code is waiting in <path>" | The direction. Logs are shipped to places the secrets are not |
| D5 | **Compared as an HMAC-SHA256 keyed with `BETTER_AUTH_SECRET`**, with a timing-safe compare. The environment's code is hashed the same way at the moment of the check, so one compare covers both sources | A stored hash that also needs the server's secret cannot be brute-forced offline from a database copy |
| D6 | **Twelve characters in three groups of four**, from the 31-character alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0, O, 1, I, L). About 59 bits. Input is upper-cased with spaces and dashes removed, so `abcd efgh jkmn` and `ABCD-EFGH-JKMN` are the same | The direction. Read off a terminal and typed by a person |
| D7 | **The code travels in the sign-up request, in the `x-openokr-setup-code` header.** Better Auth's `user.create.before` hook reads it from the hook context. It is the hook that already admits the first account (D17), so the check sits beside the rule it narrows. The wizard's form sends it through `authClient.signUp.email`'s fetch options. A script adds one `-H` | One request for every claimant, browser or script. A cookie set by a separate step would need two requests and a second thing to expire |
| D8 | **The unclaimed branch of the hook requires the code.** No code, or a wrong one: the account is refused with the error code `SETUP_CODE_REQUIRED` or `SETUP_CODE_WRONG`, and the form shows a catalogue sentence. A claimed instance never reads the header | D17 stays the only path to the first account, now with a proof |
| D9 | **Behind the existing rate limit.** `/sign-up/email` already has the sign-in rule in `LIMIT_RULES` (`packages/core/src/auth/auth.ts`), counted per client address and shared by every replica. No new counter. At about 59 bits, guessing through any rate a server answers is not a plan | The direction. A lockout counter of its own would let a stranger lock the operator out of their own claim |
| D10 | **Valid until setup finishes**, then dead: the hook's unclaimed branch is the only reader, and `completeSetup` deletes `setup.codeHash` and the file in the same step that records setup as done | The direction. "Single use" falls out: one claim finishes setup |
| D11 | **The wizard asks for the code on the account step**, as its first field, with one line saying where it is for each kind of deployment (D3's path when the server made it). `/setup` itself stays readable without the code: it shows only a checklist | One more field, not one more page. The checklist reveals nothing an operator needs to hide |
| D12 | **A cloud instance claims the same way.** The claim of a new cloud instance needs the code. Sign-ups afterwards do not, as today | The hostname problem is the same for a cloud |
| D13 | **No migration.** `system_settings` exists and holds instance rows. `setup.codeHash` is declared in the instance settings registry as internal and not editable | |

## 4. The flow

```
deploy                     server boot                        wizard (/setup/account)
------                     -----------                        ------------------------
./openokr up               unclaimed and no env code?         Setup code  [ABCD-EFGH-JKMN]
 -> OPENOKR_SETUP_CODE      -> make code, insert HMAC          Your name, email, password
 -> printed once               (conflict: another won)        Create account
helm install               -> winner writes file               -> POST /api/auth/sign-up/email
 -> Secret setup-code       -> log "waiting in <path>"            x-openokr-setup-code: ...
                                                               -> hook: unclaimed? check code
                                                               -> account, verified (BUG-028)
                                                               -> completeSetup: delete hash
                                                                  row and file
```

## 5. What the operator sees

| Where | Text (English; Malay in the catalogue) |
|---|---|
| `./openokr up`, first run | `Setup code: ABCD-EFGH-JKMN. The setup wizard asks for it. It is also in secrets/app.env.` |
| Helm notes, install only | `The setup wizard asks for a setup code. Read it with: kubectl -n <ns> get secret <name>-secrets -o jsonpath='{.data.setup-code}' \| base64 -d` |
| Server log, generated code | `A setup code is waiting in /app/storage/setup-code. The setup wizard asks for it.` |
| Wizard field help | `Printed by ./openokr up and kept in secrets/app.env. On Helm, in the release's Secret. Otherwise in <path> on the server.` |
| Wrong or missing code | `That setup code is not right. Check it and try again.` |

## 6. Where it is built

| Piece | File |
|---|---|
| Generate, normalise, HMAC, compare | `packages/core/src/setup/setup-code.ts` (pure apart from the insert and the file write) |
| Boot: make a code when none is set | `apps/web/instrumentation.node.ts`, through a core function |
| The check | `packages/core/src/auth/auth.ts`, the unclaimed branch of `user.create.before`, switched on by the `setupCode` option of `createAuth`. Only `apps/web/lib/auth.ts` passes it, so the many tests and commands that build their own instance and claim it by signing up are unchanged. With the option on and no code in force (neither the variable nor a stored hash), the sign-up is refused as `SETUP_CODE_REQUIRED`: it fails closed |
| Clear on finish | `packages/core/src/setup/complete.ts` |
| Variable | `packages/config/src/env.ts`: `OPENOKR_SETUP_CODE`, optional, normalised by D6 and at least 12 characters once normalised |
| Field and catalogue | `apps/web/app/setup/account/setup-account-form.tsx`, `packages/ui/src/i18n/messages/{en,ms}.json` |
| Compose | `deploy/docker/openokr` (generate, write, print), `deploy/docker/smoke-test.sh` |
| Helm | `deploy/helm/templates/secrets.yaml`, `deployment.yaml` env, `NOTES.txt`, `check.sh`, `cluster-test.sh` |
| Scripts that claim | `deploy/demo/reset.sh`, `deploy/staging/deploy-staging.sh` and `seed.sh`, the end-to-end wizard server's environment |
| Docs | TECHNICAL-PLAN §8.2, `registration-policy.md` §10 (D18 now points here), `docs/install/*`, `docs/runbooks/upgrade.md` (U1) |

## 7. Acceptance criteria

- Given an unclaimed instance with `OPENOKR_SETUP_CODE` set, when somebody signs up without the header, then no account is created and the form says the code is not right.
- Given the same instance, when the operator signs up with the code in any case and with or without dashes, then the owner is created, verified, and setup finishes.
- Given that instance once claimed, when somebody signs up with the old code, then the code is ignored and the registration policy decides, as today.
- Given an unclaimed instance with no `OPENOKR_SETUP_CODE`, when the server boots, then `system_settings` holds `setup.codeHash`, the file `<root>/setup-code` holds a code that passes, and the log names the path and not the code.
- Given two processes booting together on that instance, then exactly one hash row exists and the file's code passes.
- Given setup finishes, then the hash row and the file are gone.
- Given a claimed instance upgraded to 0.9.0, when it boots, then no code is made and no file is written.
- Given `helm install`, then the notes say how to read the code; given `helm upgrade`, then they do not.

## 8. Tests

| Kind | Where | What |
|---|---|---|
| Unit | `packages/core/test/setup-code.test.ts` | D6 alphabet and grouping, normalising, HMAC compare, both sources |
| Integration | `packages/core/test/registration-policy.test.ts` | D8 refusals, the claim with a code, the code ignored once claimed, D2's race, D10 clearing |
| End to end | `e2e/first-run-wizard.spec.ts` | The field; a wrong code refused; the right one claims |
| Deployment | `deploy/docker/smoke-test.sh`, `deploy/helm/check.sh`, `deploy/helm/cluster-test.sh` | The claim with the code read from the secrets; the install notes |

## 9. Questions the direction did not settle

| # | Question | Recommended | Other option |
|---|---|---|---|
| Q1 | With S3 storage and no `OPENOKR_SETUP_CODE`, the file lands on the container's local disk, not a volume. Fine? | Yes. It only has to outlive the claim. The wizard still names the path and the `docker exec` command | Refuse to boot an unclaimed S3 instance without `OPENOKR_SETUP_CODE` |
| Q2 | A code that leaks before the claim: can the operator change it? | Yes: change `OPENOKR_SETUP_CODE` and restart, or delete the file and the `setup.codeHash` row and restart. Written in the install guide | A command that rotates it |
| Q3 | Does the demo instance need the code? | Yes, read from `secrets/app.env` like `BETTER_AUTH_SECRET` already is. No exception for the demo | Skip it for the demo project name |
