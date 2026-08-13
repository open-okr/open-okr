# Phase 2 exit checklist

Run before P3-T00, 2026-08-11. The criteria are IMPLEMENTATION-PLAN.md's Phase 2
exit line, one row each, with the evidence rather than an assertion.

Phase 1's checklist learned two rules and this one keeps them: a gate that
cannot find its input must fail rather than pass, and a capability is not
shipped until something can reach it. A third rule from the P1 post-exit review
applies here too: a test that asserts the current behaviour is not the same as a
test that asserts the intended one.

Each verdict carries **how** it was verified, because in this phase that varies
more than the verdicts do.

## The criteria

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Relationship access enforced through one entry point with its lint | **Met, verified against a real database** | P2-T01 and P2-T02. Four tables, `can()` and `getAccessScoped` as the single entry point. `packages/core`'s suite ran 370/370 against real Postgres on 2026-08-10 and found the largest defect of the phase in doing so: `workspace_standard` held no binding on the workspace's own context, so every non-founding member resolved to access level 0 everywhere. Fixed at provisioning plus a backfill script |
| 2 | The people lifecycle safe | **Met, verified by suite** | P2-T03. `manager-chain.ts` with cycle detection and a depth cap, `lifecycle.ts` refusing to strand the last admin. No migration needed |
| 3 | Invitations and links | **Met, mail path unproven end to end** | P2-T04. Migration 0010, `invite_links` with a SHA-256 token hash, the first caller to go through the outbox rather than a direct send. No invitation has ever been delivered to a real mailbox, which is the same caveat Phase 1 carried and nothing has yet closed |
| 4 | Files with quotas and previews | **Met, verified by suite** | P2-T05. Migration 0011. Content type sourced from the `blobs` table rather than a process-local map, which is what made it survive a restart |
| 5 | Subscriptions and access-gated notifications with batching and the daily summary | **Met, verified by suite** | P2-T06. Also fixed two realtime defects inherited from P1: a memoised rejected connection promise, and a dropped connection that never re-issued `listen` |
| 6 | The typed feed live and leak-tested | **Met, verified by suite** | P2-T07. 19 registered activity kinds, each with a Zod schema, validated inside `runOperation` before the insert, so an unregistered kind fails the whole write |
| 7 | Settings and the module registry | **Met, verified by suite** | P2-T08. Found a real defect in the shared pipeline while building: `defineWriteAction` never passed the declared `access` level to `runOperation`, so every write silently enforced `edit` regardless of declaration |
| 8 | The security baseline | **Met, verified by suite** | P2-T09. Freeze overlay, CSP, session revoke, cache headers. `InProcessCache` now bounded rather than immortal |
| 9 | The shell, tokens, editor and languages | **Met, verified in a real browser** | P2-T10 and P2-T11. This is the only criterion exercised by hand in an actual browser, and doing so found five defects every static check had passed: a missing `globals.css` import that meant the app had produced zero Tailwind output for its whole life, a missing CSP nonce silently blocking an inline script, three files missing `"use client"`, a prop-identity bug tearing down a memoised editor extension set on every keystroke, and an async race in the slash-menu renderer |
| 10 | The data-change runner | **Met, verified against a real database** | P2-T12. The first real run found the runner reporting lifetime-cumulative row counts instead of the current call's own, and two data-change scripts calling `max()` on a `uuid` column, which Postgres has no overload for. Both scripts would have failed outright the first time either ran |
| 11 | The provider port with every driver | **Met, no driver has reached a real provider** | P2-T13. Anthropic, OpenAI-shaped, Google, plus OpenRouter, Ollama and any OpenAI-compatible endpoint through the shaped driver. Every driver is tested against a fake transport. Not one has made a request to a real vendor endpoint. This is the phase's clearest instance of "a capability is not shipped until something can reach it" and it is not closed |
| 12 | Keys encrypted with rotation | **Met, verified by suite** | P2-T14. Migration 0015. Envelope encryption, `pnpm keys:rotate` re-wraps onto the current root key |
| 13 | Tier routing, structured output and versioned prompts | **Met, verified by suite** | P2-T15. Migration 0016, four workspace-scoped tables |
| 14 | Metering with quotas and hard caps | **Met, verified by suite** | P2-T16. Migration 0017, per-call usage events with quota and hard-cap enforcement |
| 15 | The agent runtime with sandbox and proposals | **Met, verified against a real database** | P2-T17. Migration 0018. `packages/agents` gained its first database-backed suite, 12/12. An agent owns its own `workspace_members` row with `kind = 'agent'`, so least privilege needs no new mechanism |

## Gate results, this session

Run on 2026-08-11 under Node 22 on Windows.

| Gate | Result |
|---|---|
| `pnpm typecheck` | Pass |
| `pnpm check:boundaries` | Pass, 251 files |
| `pnpm db:lint` | Pass. Migration lint 20 files, soft-delete lint 21 tables across 161 files |
| `pnpm dead-code` | Pass, no findings |
| `pnpm check:signoff` | Pass, 31 commits |
| `pnpm check:licences` | **Failed, then fixed.** See below |
| `pnpm lint` | 232 diagnostics, every one of them line-ending noise. See below |
| Vitest, `packages/ui` | 54/54 |
| Vitest, `apps/web` | 16/16 |
| Vitest, `packages/core`, `db`, `adapters`, `agents`, `test-support` | **Could not run.** No database reachable |
| `pnpm test:e2e` | **Could not run.** Needs Docker, which this machine does not have |

## Two findings from running the gates

**The licence gate had never executed on this machine.** `pnpm check:licences`
spawned `pnpm` through `execFile`, which on Windows cannot resolve `pnpm.cmd`,
and which Node 22 then refuses to spawn directly at all under the `EINVAL` guard
added for CVE-2024-27980. The gate exited non-zero on every developer machine on
Windows while passing in CI on Linux. This is Phase 1's "a capability is not
shipped until something can reach it", applied to a gate. Fixed by passing
`shell: true` on win32 only, with every argument a literal. It now reports 14
distinct licences allowed and the dependency-review workflow agreeing.

**`pnpm lint` cannot be run cleanly on a Windows checkout.** All 232
diagnostics are Biome's formatter objecting to CRLF where it wants LF, across 20
files. Zero are rule violations. The cause is `core.autocrlf = true` with no
`.gitattributes` in the repository, so checkout writes CRLF and Biome, which
defaults to LF, objects to every file it touches.

The fix is one file, `.gitattributes` holding `* text=auto eol=lf`, which would
make the working tree match what the build expects. It is not applied here,
because it rewrites line endings across every file in the working tree on the
next checkout and that is a repository-wide change to ask about rather than
take. **Recorded as an open question for the human.** Until it is answered, lint
on Windows has to be read as "232 format diagnostics is the clean result", which
is exactly the kind of gate nobody trusts and therefore nobody runs.

## Caveats carried into Phase 3

**Nothing in Phase 2 has been reviewed by anyone.** Thirty-one commits sit on
one branch. There is no pull request, no review, no merge to `main`, and `main`
still ends at Phase 1. Phase 3 builds directly on top of all of it. If a review
of the access model or the Operation pipeline asks for a change, every Phase 3
task built on the current shape is affected. This is the single largest risk
crossing the phase boundary and it is a decision the human has taken knowingly.

**Three packages have never met a real database.** `packages/adapters`,
`packages/agents` and `apps/web`'s database-touching paths were never
re-exercised after the one real run on 2026-08-10, which covered only
`packages/core` and `packages/db`. That one run found nine defects, including a
foundational access-model gap invisible to every static check. The reasonable
expectation is that the untested three hold defects of the same kind.

**No end-to-end suite has run since P2-T09.** `pnpm test:e2e` needs Docker for
its database stack and a production build. This machine has native Postgres and
no Docker, so the suite cannot start here at all.

**Nothing has spoken to a real AI provider.** Criterion 11 above. Six driver
shapes, zero real requests.

**Four `packages/db` tests need PgBouncer.** `pooling-spike.test.ts` expects one
on port 56432. Known environment gap, not a defect, and it means the R1 pooling
decision is re-proven only in CI.

## Verdict

Phase 2 exits, with the review debt stated plainly. Every criterion on the exit
line is implemented, the tenant floor and the Operation pipeline carried the
whole phase without a hole appearing in them, and each of the two sessions that
pointed real infrastructure at this code found real defects rather than
confirming what was already believed. That pattern is the useful signal here:
the code is sound where something has actually exercised it, and unproven
elsewhere, and the checklist above says which is which per criterion rather than
averaging them into a tick.

P3-T00 is a design gate and needs no database, so it can proceed. The first
Phase 3 implementation task, P3-T01, writes a migration and should not start
until either a database is reachable here or the human accepts that its
verification is static only.
