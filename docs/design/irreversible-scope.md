# Irreversible acts need the destructive scope

Status: **proposed, waiting for "design approved"**. From the MCP audit (`docs/audits/mcp-audit-2026-10-29.md`, finding 12) and the OKR practitioner's recommendation in its §10.2 Q12.

This is a change to access, so it is designed before it is built (CLAUDE.md, "Three kinds of change start with the design").

## 1. What is true today

The safety class of an action is three things at once (`packages/core/src/api/surface.ts`, `catalogue.ts`):

| It decides | How |
|---|---|
| The token scope a REST, CLI or MCP call needs | `scope = safety`: `read`, `write` or `destructive` |
| The hint a client shows before an agent's call | `destructiveHint` is true only for `destructive` |
| Nothing in the browser | A signed-in person is not scoped. `can()` and the access level decide |

The registry's rule for `destructive` today is written on `cycles.close`: "Not destructive in the registry's sense, because nothing a person can see is removed." 31 actions are destructive, all of them deletions or removals.

| Action | Class today | Access | Reversible |
|---|---|---|---|
| `cycles.close` | write | full | No. There is no `cycles.reopen`. It writes the scorecard snapshot and feeds the next cycle |
| `people.suspend` | write | full | Yes, `people.restore`. Until then the person loses every access, and goals they champion or review have someone who cannot act |
| `goals.close` | write | edit | Yes, `goals.reopen`. The retrospective is kept |
| `sessions.close` | write | edit | Ends a meeting |
| `sessions.closeCommitments` | write | edit | A weekly step (METHOD.md §7.2) |

## 2. The question

A read-and-write agent token can close a cycle for the whole workspace, or suspend a colleague, and its client shows the call as an ordinary write. Should that need the destructive scope?

## 3. Proposal

Widen the registry's rule from "removes something a person can see" to **"removes something, or cannot be undone, or takes access from a person"**, and apply it to two actions.

| Action | Change | Why |
|---|---|---|
| `cycles.close` | `write` to `destructive` | Cannot be undone, and fixes every space's result at once |
| `people.suspend` | `write` to `destructive` | Takes all access from a person. A default token should not do that to a human |
| `goals.close`, `sessions.close`, `sessions.closeCommitments` | No change | Routine and reversible |

Access levels do not change. The browser does not change.

## 4. What it costs

| Who | Effect |
|---|---|
| A person in the browser | Nothing |
| An existing API token with `write` but not `destructive` that closes cycles or suspends people (a script, the CLI) | Refused with "needs destructive" after upgrade. It needs a token with the destructive scope |
| An MCP connection | `cycles.close` and `people.suspend` disappear from a read-write grant's tool list, and the client shows a destructive warning to a grant that has the scope |
| The changelog | A minor bump with an upgrade note, because a running script can start failing |

## 5. Acceptance criteria

- **Given** a token with `read` and `write`, **when** it calls `cycles.close` or `people.suspend`, **then** the call is refused naming the destructive scope, and nothing changes.
- **Given** a token with `destructive`, **when** it calls either, **then** it runs as before, and the MCP catalogue marks it `destructiveHint: true`.
- **Given** a signed-in administrator in the browser, **when** they close a cycle or suspend a member, **then** nothing differs from today.
- **Given** the registry, **when** the catalogue invariant test runs, **then** both actions are pinned as destructive.

## 6. Open questions for the human

| # | Question | Recommendation |
|---|---|---|
| Q1 | Approve the wider meaning of destructive, and the two actions in §3? | Yes |
| Q2 | Should `goals.close` require a one-line reason? METHOD.md §2.9 and §8.8 ask for one, and the input leaves it optional today. Making it required breaks a client that leaves it out | Separate change, after this one, with its own upgrade note |
| Q3 | Should anything else move? Candidates by the same rule: `workspace.setState` to frozen, `people.erase` (already destructive) | Only the two above for now |

Write "design approved" to start the code, or name what to change.
