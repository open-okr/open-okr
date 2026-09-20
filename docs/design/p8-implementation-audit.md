# Implementation audit, 18 September 2026

Whether the plan is built, and where it is not.

Written for Agung and Obed, and for whoever reviews PR #77.

## What this audit is, and what it refuses to be

**It does not read `STATUS.md` and tick boxes.** On 17 September two rows were
`in_review` with fourteen green continuous-integration checks, and neither
feature could ever have worked. A row's status records what somebody believed;
it is not evidence.

So this looks for the classes of failure this repository has actually produced,
and tries to reproduce each one. Every finding below was executed, not
inferred, and the output is quoted.

**It is not exhaustive.** 254 rows cannot be audited deeply in one pass. What
it covers is stated at the end, along with what it did not look at, so nobody
reads silence as a clean bill.

## The headline

**Two live defects, both in the same class, both invisible to every gate.**

A read or a write that runs on a connection with no tenant setting. The
application role is `nosuperuser nobypassrls`, so Postgres answers a read with
no rows and refuses a write. Nothing throws on the read path, the fallback
looks reasonable, and the feature is silently inert.

| Finding | Effect | Severity |
|---|---|---|
| `POST /api/v1/admin/sso` cannot create a connection | **No OIDC provider can be configured at all**, by any route | High |
| `drafter.ts` cannot read the per-workspace AI spend cap | Every workspace silently runs on the hardcoded default of 2 USD | Medium |

Both are the P8-T07 and P8-T08 shape, found the same way and missed by the same
gates.

## Finding 1: single sign-on still cannot be configured

`apps/web/app/api/v1/admin/sso/route.ts:83` inserts with
`current_setting('app.workspace_id')::uuid` on a bare pool.

```
insert into sso_connections (workspace_id, ...) values (
  current_setting('app.workspace_id')::uuid, $1, $2, ...
)
```

Executed as the application role with no tenant setting:

```
RESULT: refused -> unrecognized configuration parameter "app.workspace_id"
```

`current_setting` without the missing-ok flag raises rather than returning
null, so this is a hard failure rather than a quiet one. The admin screen at
`/admin/sso` posts to this route and to no other, so **there is no way to
configure an OIDC provider on any instance.**

**Why this matters more than it looks.** P8-T07a fixed the reads, P8-T07b fixed
where a person lands, P8-T07c-a added SAML. All of them are downstream of a
provider existing. The one write that creates one was never fixed, so the whole
feature is still unreachable and its acceptance criterion still cannot be
walked.

**The sibling route is correct**, which is what makes this an omission rather
than a misunderstanding. `packages/core/src/directory-sync/tokens.ts:59` writes
`directory_sync_tokens` inside `withWorkspace` with an explicit `workspaceId`.
P8-T08a fixed that one and left this one.

**The fix** is the same shape: open the transaction with the workspace and pass
the id, rather than asking the connection what workspace it is in.

## Finding 2: the AI spend cap has never been read

`apps/web/lib/drafter.ts:40` reads the per-workspace run cost cap on a bare
pool. `workspaces` carries `tenant_isolation` from migration 0005, so an
unscoped read matches nothing.

Executed, with an administrator's cap of 25 stored first:

```
STORED:                 [{"cap":"25"}]
WHAT THE DRAFTER SEES:  []
```

The function then returns its default:

```ts
const stored = rows[0]?.cap;
return stored === null || stored === undefined ? 2 : Number(stored);
```

So `agentRunCostCapUsd` does nothing. Every workspace runs on 2 USD whatever an
administrator set, in both directions: a higher cap is ignored, and so is a
lower one.

**It fails safe on cost and unsafe on trust.** Nobody overspends, because the
default is the lowest plausible number. What breaks is that a setting the
product offers, documents and stores has no effect, and the screen that sets it
reports success.

## Finding 3: three rows are open, so the plan is not fully built

The question this audit was asked was whether everything is implemented. Three
rows say otherwise.

| Row | Title | Note in the tracker |
|---|---|---|
| `P4-T14b-b` | Copilot background runs | Cut out of P4-T14b on 26 August, blocked |
| `P6-G22d` | A message can carry a value | Found while doing P6-G22c |
| `P8-T07c-b` | The surfaces around SAML | The admin screen, the metadata document, enforcement |

`P8-T07c-b` is the one that matters here: without it there is no way to
configure a SAML provider, so the path P8-T07c-a built is unreachable. Combined
with finding 1, **neither protocol can be configured on a running instance
today.**

## Finding 4: seven rows exist in the tracker and not in the plan

| In `STATUS.md` | Missing from `IMPLEMENTATION-PLAN.md` |
|---|---|
| `P6-G27a`, `P6-G27b` | No `###` heading |
| `P7-T01a`, `P7-T01b` | No `###` heading |
| `P7-T02a` | No `###` heading |
| `P7-T03a`, `P7-T03b` | No `###` heading |

All seven are mentioned in the plan's prose and its appendix count, so the work
was recorded. What is missing is the heading that describes what each one is
for, which is what somebody reads when deciding whether it is done.

Nine plan headings have no tracker row, and all nine are parents that were
split (`P6-T03`, `P6-T04`, `P6-T05`, `P6-G22`, `P6-G27`, `P7-T01`, `P7-T03`,
`P8-T07c`, `P8-T13`). That is the convention this repository uses and is not a
gap.

## What was checked and came back clean

| Check | Result |
|---|---|
| Every command `CLAUDE.md` names exists | 43 commands, 6 shell scripts, none missing |
| Client fetches against the proxy's public list | One gated route, `/api/copilot`, correctly gated |
| Plan headings against tracker rows | No duplicates either way |
| Screens named in `UIUX-PLAN.md` | 45 named, 43 cited in source |
| Tables behind the tenant floor | 129, all classified in the archive policy |

The two screens not cited by number, `S-17 Retrospective` and `S-30 Rich text
editor`, both exist: the retrospective is in `session/[id]/management-retro.tsx`
and the editor is `packages/ui/src/rich-text/`. The convention of citing a
screen number in a comment is not universal, so this is a traceability gap and
not a missing screen.

## The pattern underneath all of it

Every serious finding in this audit, and every one in the P8-T07 and P8-T08
review before it, is the same sentence:

> Something reads or writes a table behind the tenant floor on a connection
> that has no tenant setting.

Postgres answers correctly. The caller treats the empty answer as data. A
fallback that looks sensible takes over. Nothing logs, nothing throws, and no
gate can tell the difference between "there is nothing" and "you cannot see
anything".

**Five occurrences now**: `loadSSOConnections`, `listSSOProviders`,
`resolveToken`, `createSCIMToken`, `logSyncOperation`, plus the two found here.

**No gate catches it, and one could.** The boundary gate already parses every
file for Operation-pipeline violations. A rule that refuses a `pool.query`
naming a policy-guarded table outside a known wrapper would have caught all
seven. The scan written for this audit is thirty lines and found both new ones;
the false positives are the command-line tools, which run as a role that sees
past the floor and could carry a marker the way migrations already do.

**That is the recommendation this audit exists to make.** Fixing the two
defects closes today's holes. Adding the rule is what stops the eighth.

## What this audit did not cover

Said plainly, so the clean sections above are not read as wider than they are.

- **Acceptance criteria were not walked.** Whether each row's Given/When/Then
  is exercised by a test was not checked, row by row. That is the largest
  remaining piece of assurance and it is where a third inert feature would
  hide.
- **The method conformance suite was trusted**, not re-derived. It compares
  `METHOD.md` against `packages/method` in both directions and is itself a
  gate.
- **Deployment was not exercised.** Docker and helm are absent on the machine
  this ran on, so the Compose target, the chart and the demo reset are covered
  only by continuous integration.
- **The importers were not audited.** FlowyTeam needs a MySQL source, and the
  spreadsheet path was read but not run against a real file.
- **No performance claim was re-measured.** The §13.1 budgets are taken from
  the last recorded run.

## Suggested order

1. Fix finding 1. Without it single sign-on cannot be configured, which makes
   four completed rows unreachable.
2. Add the boundary rule. It is the only change here that prevents a repeat.
3. Fix finding 2.
4. Add the seven missing plan headings.
5. Decide `P8-T07c-b`, `P6-G22d` and `P4-T14b-b`.

---

## What was done about it, 18 September 2026

Appended rather than folded into the findings above, so they still read as they
were found.

### Findings 1 and 2 are fixed, and the tests fail against the old code

`createSSOConnection` moved into `packages/core/src/auth/sso.ts` and takes the
workspace as an argument, inside `withWorkspace`. That is the shape
`createSCIMToken` has had since P8-T08a, which is the sibling that worked. The
route passes the workspace `requireAccessLevel` was already returning and
discarding.

`resolveAgentRunCostCap` moved into `packages/core/src/ai/resolve.ts` for two
reasons: it has to run inside the tenant setting, and `apps/web` has no Drizzle
and should not be writing SQL. The web app calls it.

`packages/core/test/tenant-scoped-writes.test.ts` holds six tests. Two of them
fail against the code as it was, with
`unrecognized configuration parameter "app.workspace_id"`; the cap tests
returned 2 instead of what was stored. Zero is covered too, because a falsy
check would read "may not spend" as "not set" and hand back the default, which
is the opposite instruction.

### The rule that stops the eighth

`unscoped-read-of-guarded-table`, in the boundary gate. It refuses a
`pool.query` naming a policy-guarded table outside a tenant wrapper.

**The table set is derived from the migrations by the gate**, not written down.
A table added tomorrow is covered tomorrow, and there is no second list to
drift. The gate refuses to run at all if it finds no guarded tables, because a
rule that checks nothing must not report success: that exact failure has hit
this repository twice before, in the migration lint and the soft-delete gate.

It found one thing on its first run, and it was a true positive that wanted
documenting rather than fixing: `audit/verify.ts` reads `workspaces` on a bare
pool on purpose, and refuses with a clear error when the role cannot see past
the floor. It carries `openokr:allow-unscoped-read` with that reason now, which
is the point of the escape being a written sentence rather than a silence.

Seven tests in `packages/config/test/boundaries.test.ts` hold it in both
directions: it catches a read and a write, it stays quiet inside a wrapper, on
an unguarded table, in the command line, and behind a marker, and it has no
opinion when the caller supplies no tables.

### Finding 4 was two gaps and five false positives

**The scan that produced it looked for `###` and the plan writes some parts as
`####`.** P7-T01a, P7-T01b, P7-T02a, P7-T03a and P7-T03b each had a full
heading all along, with deliverables and an acceptance line, one level further
down. Only P6-G27a and P6-G27b were genuinely described by bullets under their
parent and nowhere else.

That is worth recording rather than quietly fixing, because it is the audit
making the mistake the audit is about: a check that answers a narrower question
than the one it is read as answering. The finding said "no heading" and what it
could see was "no `###`".

Both halves are closed now. P6-G27a and P6-G27b have headings in the shape
every other lettered part uses, written from what the tracker records they
turned out to be. The five `####` headings are `###`, which is the level every
other split part in the document uses, so the inconsistency that made the scan
wrong is gone rather than documented around.

All 254 tracker rows now resolve to a heading. Nine headings still have no row
and all nine are split parents, which is the convention.

### Still open

| Row | Why it is still open |
|---|---|
| `P8-T07c-b` | The admin screen for SAML, the metadata document, enforcement. Until it lands, SAML cannot be configured even though the sign-in path works |
| `P6-G22d` | A message can carry a value |
| `P4-T14b-b` | Copilot background runs, blocked |

The seven rows named in finding 4 are closed: two headings written, five already present a level down.

**Finding 1 unblocked OIDC, not SAML.** An administrator can configure an OIDC
provider now. SAML still has no screen, so P8-T07c-b remains the row that makes
that half reachable.
