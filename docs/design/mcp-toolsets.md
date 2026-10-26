# MCP toolsets: a catalogue an agent can hold

Proposed and approved 23 October 2026, from MCP UAT BUG-004, with the
proposed answers to Q1 to Q3. Built the same day. One change from the proposal:
`workflow.read` moved into `core`, because the review-against-the-canon prompt
cites it, which the prompt-citation test caught.

Authority: AI-NATIVE-PLAN.md §8.3 (what the server exposes), then
`docs/design/agent-surface.md` §5.2 and "The tool catalogue (P5-T09a)". This
document proposes a change to both, listed in §7.

## 0. What is true today

`tools/list` answers every connection with the whole registry.

| Measure | Value |
|---|---|
| Tools in `contract/mcp.json` | 415 |
| Size of the catalogue (names, descriptions, schemas) | 280 KB |
| Tools a read-only token can call | 156 |
| Write and destructive tools a read-only token is still shown | 259 |
| Largest families | `sessions` 72, `goals` 59, `ai` 28, `people` 18, `kpis` 17 |

What that does to a person using an agent:

| Client behaviour | Effect |
|---|---|
| Caps the number of tools (several cap at 128 or fewer) | Tools past the cap are silently dropped, in an order nobody chose |
| Loads every schema into the model's context | About 70,000 tokens spent before the first question |
| Shows the tool list to the person for approval | 415 rows to read, most of them admin or facilitation |
| Model picks a tool by description | More near-duplicates (`search`, `search.query`, `search.entities`) and more wrong picks |

The UAT tester's own words: the catalogue is too big, and users will be
confused.

## 1. Constraints this design keeps

| Constraint | Source | How it is kept |
|---|---|---|
| The tools span the whole product | AI-NATIVE-PLAN §8.3 | Every tool stays reachable. A toolset narrows the default, never what can be asked for |
| Destructive tools are listed, not hidden | agent-surface.md "Destructive tools are listed, not hidden" | Toolsets are cut by job, not by safety. A destructive tool sits in the same toolset as its write |
| One registry, generated projections | CLAUDE.md, the action contract | Toolsets are data over the registry. The drift gate covers them |
| `can()` decides | TECHNICAL-PLAN §8.1 | Unchanged. Filtering is presentation; the scope gate and `can()` still run on every call |

## 2. The change, in three parts

### 2.1 A token is shown only what its scopes can call

`tools/list` leaves out a tool whose scope the connection does not hold. A
read-only token sees 156 tools instead of 415. Calling a hidden tool still
answers the scope refusal it answers today, so nothing a client relied on
breaks.

This is not hiding destructive tools: a token with the destructive scope sees
them. It is not listing what the server would refuse anyway.

### 2.2 Tools that are not for agents leave the agent surface

Twenty actions exist for the importer, the scheduler, the copilot's own
bookkeeping, or the token screen, and an agent can only misuse or be refused
by them.

| Kind | Actions |
|---|---|
| Importer only (they keep a source author and date) | `people.importMember`, `subscriptions.importWatcher`, `goals.importCheckIn`, `comments.importComment`, `comments.replaceImportedBody`, `blobs.prepareImport`, `imports.startRun`, `imports.finishRun` |
| Scheduler and housekeeping | `notifications.drainBatches`, `blobs.reapOrphans`, `channels.sweepMessageLog` |
| The copilot's own bookkeeping | `copilot.recordAnswer`, `copilot.completeRun`, `copilot.recordProposal` |
| Registration and the key check | `workspace.provision`, `ai.recordCredentialCheck` |
| Refused to every token by design (§8.2 "a token cannot administer tokens") | `tokens.create`, `tokens.revoke`, `tokens.approveDevice`, `tokens.pendingDevice` |

The action gains `agentSurface: false`. The catalogue generator skips it and
the dispatcher refuses it by name. It stays on REST and the command line for
now; whether it should leave those too is open question Q3.

### 2.3 Toolsets, chosen in the server URL

A toolset is a named slice of the catalogue, cut by the job a person does.

| Toolset | Holds | Tools |
|---|---|---|
| `core` | What a member does every week: search and fetch, goals and key results, check-ins and acknowledgement, the review inbox, notifications, comments, KPIs read and record, tasks, initiatives, documents, the blocker board, my sessions, the planning workflow read that a prompt cites | 57 (36 read-only) |
| `work` | The rest of everyday work: drafts and approvals, targets and history, dependencies on key results, KPI trees and recovery, checklists, attachments, reactions, the copilot | 89 |
| `facilitation` | Running the rhythm: sessions, the planning workflow, cycles, alignment, votes, dependencies, decisions, closing | 113 |
| `admin` | Workspace, people, spaces, roles, invitations, settings, single sign-on, audit, channels, AI, agents, practice, nudges, exports | 135 |
| `all` | Every agent-surface tool | 395 |

Chosen in the address the client is configured with, so it works with every
client and needs no new column:

```
https://okr.example/api/mcp                       -> core
https://okr.example/api/mcp?toolsets=core,facilitation
https://okr.example/api/mcp?toolsets=all
```

| Rule | Why |
|---|---|
| A tool outside the chosen toolsets is refused on call with a sentence naming the toolset that holds it | The list and the call must agree, or an agent that guessed a name gets a different product than its list |
| An unknown toolset name is a 400 that lists the known ones | A typo should not silently become `core` |
| Toolsets compose with scopes: the list is the intersection | A read-only token on `admin` sees the admin reads only |
| `search` and `fetch` are in every toolset | Research connectors need them, and they are permission-filtered already |
| Every tool a prompt cites is in `core` | A prompt that tells the agent to call a tool it cannot see is broken |
| Every agent-surface tool is in exactly one of `core`, `work`, `facilitation`, `admin` | A new action fails the build until somebody places it |

The token screen's configuration snippet gains one line explaining
`?toolsets=` and showing the `all` form.

## 3. What it measures after

| Connection | Tools today | Tools after |
|---|---|---|
| Full token, no toolsets named | 415 | 57 |
| Read-only token, no toolsets named | 415 | 36 |
| Full token, `core,work` | 415 | 146 |
| Full token, `all` | 415 | 394 |

`core` is about 41 KB instead of 280 KB.

## 4. Options considered and not taken

| Option | Why not |
|---|---|
| Two meta-tools, `find_action` and `run_action`, over the registry | The model loses typed schemas and annotations, every call costs an extra round trip, and a client can no longer show a person which tool is about to run |
| Toolsets stored on the token or grant | Needs a migration on two tables and a choice on two screens for the same effect as the URL. Can follow later if a workspace wants to restrict rather than default |
| Hiding destructive tools from `core` | Breaks "listed, not hidden". `comments.delete` belongs with `comments.create` |
| Filtering by the member's role | The list would differ per person and per role change, and `can()` already refuses. Scope filtering is stable per token |

## 5. Acceptance criteria

```
Given a token with read, write and destructive scope
When an agent calls tools/list on /api/mcp with no toolsets named
Then it receives the 57 core tools
And search, fetch and every tool a prompt cites are among them
```

```
Given a read-only token
When an agent calls tools/list on /api/mcp?toolsets=all
Then no tool with write or destructive scope is listed
```

```
Given a connection on core
When the agent calls sessions.advanceStage
Then the call is refused with a sentence naming the facilitation toolset
And nothing is written
```

```
Given any connection
When the agent calls comments.importComment
Then it is refused, and the tool is not in tools/list for any toolset
```

```
Given /api/mcp?toolsets=core,nonsense
When the client connects
Then the answer is 400 and lists core, work, facilitation, admin and all
```

```
Given a new registry action with no toolset
When the build runs
Then the catalogue test fails and names the action
```

## 6. The work

| Step | Deliverable |
|---|---|
| 1 | `agentSurface: false` on the twenty actions; generator skips, dispatcher refuses; `contract/mcp.json` regenerated |
| 2 | Scope filtering in `tools/list` |
| 3 | `packages/core/src/api/mcp/toolsets.ts` as data, the `?toolsets=` parameter, the refusal on call, the 400 |
| 4 | Tests for every criterion in §5, the placement test, the prompt-citation test |
| 5 | Token screen snippet, `docs/` page for agent setup, AI-NATIVE-PLAN and agent-surface.md updated |

One change and one commit; it is all the same projection.

## 7. What changes in the plan set

| Document | Change |
|---|---|
| AI-NATIVE-PLAN.md §8.3 | Tools still span the whole product; add that a connection sees the toolsets it names, `core` by default, filtered by its scopes, and that importer and housekeeping actions are not agent tools |
| agent-surface.md §5.2 and "The tool catalogue" | The catalogue is per connection; record the toolsets and the placement invariant |
| CLAUDE.md | Nothing |

## 8. Open questions

| # | Question | Proposed answer |
|---|---|---|
| Q1 | Default when no toolset is named: `core` or `all`? | `core`. The point is a small default; anyone who wants more adds one parameter. It changes what existing connections see, which the changeset says |
| Q2 | Should `spaces.list` and `spaces.read` be in `core`? | Yes, counted above: a member needs a space id to create a task |
| Q3 | Should the twenty non-agent actions also leave REST and the command line? | Not in this change. The importer reaches them through the internal client, and moving them is a separate decision about the REST contract |
