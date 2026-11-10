# Irreversible acts need the destructive scope

Status: **Approved by Akmal on 9 November 2026 ("design approved").** Q1: yes. Q2: the close dialog asks for a one-line reason and leaves it optional; the API is unchanged. **Q3: `people.convertToGuest`, `workspace.setState` and `sessions.close` move to destructive too.** From the MCP audit (`docs/audits/mcp-audit-2026-10-29.md`, finding 12) and the OKR practitioner's recommendation in its §10.2 Q12.

**Checked again 9 November 2026 for release 0.7.0 (plan O6).** Every statement was read against the code on `release-0.7.0`. What changed:

| Where | Change |
|---|---|
| §1 | The safety class does four things, not three: it also decides which tools an agent connection is offered. File and line for each |
| §1 | The rule for `destructive` lives in the type's comment in `define.ts` and in `destructive-verbs.test.ts`; the comment on `cycles.close` repeats it |
| §1 | 33 destructive actions is still right, but not all are removals: `workspace.setLifecycle` closes a workspace, and `spaces.removeMember` takes a person's access to a space, which is the precedent for `people.suspend` |
| §1 | `sessions.close` is not reversible (there is no `sessions.reopen`); `sessions.closeCommitments` is, by calling it again |
| §3 | The wider rule said "cannot be undone", which would have taken `sessions.close` too. Narrowed to what the two actions actually share |
| §4 | The real refusal sentences; the command line's default login; the toolsets; and that SCIM, chat, the copilot and the built-in agents are not scoped |
| §4, §7 | The screens that describe the destructive scope to a person say it removes or deletes things. They change in the same change, or a person granting a token is told less than it does |
| §5 | The test that pins the classes is `destructive-verbs.test.ts`, by verb. Neither verb here is a removing one, so both are pinned by name |
| §6 | Q3 names `people.convertToGuest` as the nearest candidate by the same rule |
| §7 | New: what changes in the same change |

This is a change to access, so it is designed before it is built (CLAUDE.md, "Three kinds of change start with the design").

## 1. What is true today

The safety class of an action is four things at once:

| It decides | How |
|---|---|
| The token scope a REST, CLI or MCP call needs | `scope = safety`: `read`, `write` or `destructive` (`packages/core/src/api/surface.ts:104-105`). Checked at `/api/v1` (`apps/web/app/api/v1/[[...path]]/route.ts:193-200`) and at the agent endpoint (`packages/core/src/api/mcp/dispatch.ts:87-93`) |
| Which tools an agent connection is offered | Only those its scopes reach (`offeredTools`, `packages/core/src/api/mcp/toolsets.ts:69-77`) |
| The hint a client shows before an agent's call | `destructiveHint` is true only for `destructive` (`packages/core/src/api/mcp/catalogue.ts:322-323`) |
| Nothing in the browser | A signed-in person is not scoped: `callAction` checks no scope, and `can()` and the access level decide. The same holds for every caller inside the server: chat commands, the copilot, the built-in agents and SCIM |

The rule for `destructive` is the type's own comment, "Read, write, or write that removes something a person can see" (`packages/core/src/actions/define.ts:32`). The comment on `cycles.close` repeats it: "Not destructive in the registry's sense, because nothing a person can see is removed" (`packages/core/src/actions/cycles.ts:1944-1945`). `packages/core/test/destructive-verbs.test.ts` holds it by name: a tool whose name has a removing verb (`erase`, `delete`, `remove`, `archive`, `revoke`, `disconnect`, `detach`, `unlink`) must be destructive.

33 actions are destructive: 31 agent tools, plus `workspace.setLifecycle` and `tokens.revoke`, which are not tools. Most are deletions or removals. Two matter here because they are not plain removals: `workspace.setLifecycle` closes a workspace that is erased once its window passes, and `spaces.removeMember` takes a person's access to one space. A token already needs the destructive scope to take somebody out of a space, and not to take them out of the whole workspace.

| Action | Class today | Access | Reversible |
|---|---|---|---|
| `cycles.close` (`packages/core/src/actions/cycles.ts:1947`) | write | full | No. There is no `cycles.reopen`. It writes the scorecard snapshot and feeds the next cycle. `closeCycleInTx` (`packages/core/src/cycles/archive.ts:943`) is called by nothing else, so this is the only way a cycle closes |
| `people.suspend` (`packages/core/src/actions/people.ts:401`) | write | full | Yes, `people.restore`. Until then the person loses every access, and goals they champion or review have someone who cannot act. SCIM deprovisioning calls it inside the server (`packages/core/src/directory-sync/users.ts:193`) |
| `goals.close` | write | edit | Yes, `goals.reopen`. The retrospective is kept |
| `sessions.close` | write | edit | No: there is no `sessions.reopen`. It ends one meeting and writes that week's digest |
| `sessions.closeCommitments` | write | edit | Yes: calling it again replaces the verdict. A weekly step (METHOD.md §7.2) |

## 2. The question

A read-and-write agent token can close a cycle for the whole workspace, or suspend a colleague, and its client shows the call as an ordinary write. Should that need the destructive scope?

## 3. Proposal

Widen the registry's rule from "removes something a person can see" to **"removes something a person can see, fixes a result for the whole workspace that cannot be undone, or shuts a person out of the workspace"**, and apply it to two actions. The new sentence replaces the comment at `define.ts:32` and the one on `cycles.close`.

*Corrected 9 November 2026.* The first wording was "removes something, or cannot be undone, or takes access from a person". "Cannot be undone" alone also takes `sessions.close`, which has no reopen and is routine. "Takes access from a person" alone also takes `people.convertToGuest`, which strips a member's bindings, and every role change that lowers a level. The narrower sentence names what the two actions share and nothing else; Q3 keeps the neighbours open.

| Action | Change | Why |
|---|---|---|
| `cycles.close` | `write` to `destructive` | Cannot be undone, and fixes every space's result at once |
| `people.suspend` | `write` to `destructive` | Takes all access from a person. A default token should not do that to a human |
| `goals.close`, `sessions.close`, `sessions.closeCommitments` | No change | Routine. `goals.close` and `sessions.closeCommitments` can be undone; `sessions.close` cannot, but it fixes one meeting and nothing beyond it |

Access levels do not change. The browser does not change.

## 4. What it costs

| Who | Effect |
|---|---|
| A person in the browser | Nothing they do changes. The words that describe the destructive scope on three screens do (§7) |
| SCIM deprovisioning, chat commands, the copilot, the built-in agents | Nothing. They call the action inside the server, where no scope applies |
| An existing API token with `write` but not `destructive` that closes cycles or suspends people (a script) | Refused after upgrade with `insufficient_scope`: "cycles.close needs the destructive scope. This token has: read, write." It needs a token with the destructive scope |
| The command line | `okr login` asks for read and write when nobody says (`packages/cli/src/run.ts:156`), so `okr cycles close` is refused after upgrade. `okr login --scopes read,write,destructive` is the answer |
| An MCP connection | `cycles.close` and `people.suspend` disappear from a read-write grant's tool list, and a call is refused as a tool result: "That connection has read and write scope, and cycles.close needs destructive." A grant with the scope sees `destructiveHint: true`. Either tool is offered only to a connection that chose its toolset: `facilitation` for `cycles.close`, `admin` for `people.suspend` (`packages/core/src/api/mcp/toolset-data.ts:184`, `:301`) |
| The audit trail | Once A3 is built, a refusal at the agent endpoint writes an audit row naming the channel |
| The changelog | A minor bump with an upgrade note, because a running script can start failing. 0.7.0 is a minor release, so the note goes in its section of `docs/runbooks/upgrade.md` |

## 5. Acceptance criteria

- **Given** a token with `read` and `write`, **when** it calls `cycles.close` or `people.suspend`, **then** the call is refused naming the destructive scope, and nothing changes.
- **Given** a token with `destructive`, **when** it calls either, **then** it runs as before, and the MCP catalogue marks it `destructiveHint: true`.
- **Given** a signed-in administrator in the browser, **when** they close a cycle or suspend a member, **then** nothing differs from today.
- **Given** a directory that deactivates a user over SCIM, **when** the request is handled, **then** the member is suspended as today.
- **Given** the registry, **when** `packages/core/test/destructive-verbs.test.ts` runs, **then** both actions are pinned as destructive by name, beside `people.erase`, because neither `close` nor `suspend` is one of its removing verbs.
- **Given** the regenerated contract, **when** `pnpm check:contract` runs against the old one, **then** it names both actions with "its scope moved from write to destructive".

## 6. Open questions for the human

| # | Question | Recommendation |
|---|---|---|
| Q1 | Approve the wider meaning of destructive, and the two actions in §3? | Yes |
| Q2 | Should `goals.close` require a one-line reason? METHOD.md §2.9 and §8.8 ask for one, and the input leaves it optional today. Making it required breaks a client that leaves it out | Separate change, after this one, with its own upgrade note |
| Q3 | Should anything else move? The nearest candidates: `people.convertToGuest`, which strips a member's bindings but leaves them in the workspace; `workspace.setState` to frozen, which `setState` to active undoes; `sessions.close`, which cannot be undone but fixes one meeting only. `people.erase` is already destructive | Only the two above for now |

## 7. What changes in the same change

- `packages/core/src/actions/cycles.ts` and `people.ts`: `safety: "destructive"` on the two actions, and the `cycles.close` comment.
- `packages/core/src/actions/define.ts:32`: the rule, in §3's words.
- `packages/core/test/destructive-verbs.test.ts`: the two pinned by name.
- `contract/openapi.json`, `cli.json`, `mcp.json` regenerated; `docs/api/reference.md` with them.
- The words a person reads when granting the scope, which today say it only removes or deletes: `SCOPE_DESCRIPTIONS.destructive` (`packages/core/src/api/oauth/consent.ts:269`, the consent screen), `account.apiTokens.scopeDestructiveHint` and `account.device.readSeesWhatYou` in `packages/ui/src/i18n/messages/en.json` and `ms.json`, the Scopes row of `docs/api/README.md`, and the comment on the command line's default at `packages/cli/src/run.ts:181-183`.
- `docs/runbooks/upgrade.md`, the 0.6 to 0.7 section: both actions in the "What an API client may meet" table, with the command line's `--scopes`.
- A changeset.

Write "design approved" to start the code, or name what to change.
