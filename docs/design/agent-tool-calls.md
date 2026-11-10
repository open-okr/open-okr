# A record of every tool call an external agent makes

Status: proposed 9 November 2026 for release 0.7.0 (plan A2). Approved by Akmal on 9 November 2026 ("design approved"). Q1: yes, with the reason marked in code. Q2: 90 days. Q3: yes, AI-NATIVE-PLAN §7 and §8.1 change to match in the same change. A schema change, so it is designed first (CLAUDE.md).

A new document rather than a section of [agent-surface.md](agent-surface.md), which is already long. That document's §5.2 and AI-NATIVE-PLAN §7 and §8.1 are where the record is promised.

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The dispatcher | `packages/core/src/api/mcp/dispatch.ts:66-179` | Runs one tool or returns a refusal. Refuses an unknown tool (74-76), a tool outside the chosen toolsets (80-85), a scope it lacks (87-93), a server-set field (95-102), then in the catch an invalid input (153-169), an `OperationError` (170-174) or a fault (177) |
| A resource read | `dispatch.ts:188-216` | Runs through `dispatchTool`, so one hook covers tools and resources |
| The audit tag | `dispatch.ts:145`, `packages/core/src/operations/operation.ts:736-749` | A write's audit row carries `channel: "mcp"`, inside the hash chain. A read, `search`, `fetch` and every refusal leave nothing beyond the token's or session's last-use stamp |
| The principal | `apps/web/app/api/mcp/route.ts:282-290` | Hands the dispatcher the workspace, user, scopes and toolsets. Not the member, grant or token, although `resolveAgentPrincipal` has all three (`packages/core/src/api/mcp/principal.ts:43-53`) |
| Records kept outside the pipeline | `packages/core/src/api/tokens.ts:245-272` (`stampTokenUse`), `api/mcp/sessions.ts:154-168` (`recordSessionFor`), `sessions.ts:227-250` (`stampSessionUse`) | A `withWorkspace` transaction, no activity or audit row, an `openokr:allow-mutation` reason. The precedent for a record that is not domain state |
| AI usage | `packages/core/src/ai/usage.ts:104-223` | One row per provider call, through `runOperation` with `bootstrap: true`, so each row also writes an activity and an audit row. `provider` and `model_id` are not null and `provider` is checked against six names (`0017_ai_usage_and_budgets.sql:19-23`) |
| A retention sweep | `packages/core/src/actions/channels.ts:1309`, `apps/web/lib/scheduler.ts:212` | `channels.sweepMessageLog`: a daily pipeline write per workspace that deletes rows past a workspace setting and audits the count |
| The table | AI-NATIVE-PLAN §7, DATABASE.md §15 | `ai_tool_calls` with `input jsonb`, `output_excerpt` and `permission_checked`. No migration creates it |
| What an admin sees | `apps/web/app/admin/ai/page.tsx:187` (usage card), `apps/web/app/admin/audit` | Provider-call totals, and the audit log with agent writes in it. No count of agent calls |
| What a member sees | `/account/connections` (grants, `connections.mine`), `/account/api-tokens` (agent tokens) | Last use only |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | One table, `ai_tool_calls`, the specification's name. One row for every call that reaches `dispatchTool` | A 401 has no workspace to record against and a 429 has named no tool yet. `tools/list` and `initialize` are not calls |
| D2 | **No argument value, no result and no refusal sentence is ever stored.** The columns are in §2 | Arguments carry titles, comment bodies, search words and URLs. A refusal can carry a name. A record that never held them cannot leak them |
| D3 | `target_ids`: the top-level input values that are UUIDs, at most five | Says which goal an agent read without saying what it read. An identifier in this workspace is not a secret, and the audit trail already keeps the same kind |
| D4 | `outcome` (§2.1) replaces the specification's `permission_checked` | Every call is checked by construction (two gates, agent-surface.md "Two gates on every call"), so that boolean is always true. Where the call stopped is the useful fact |
| D5 | **Written outside the Operation pipeline**: one insert after the call returns, in its own `withWorkspace` transaction, marked `openokr:allow-mutation` with the reason. See §3 and **Q1** | It records that a call happened. Nothing reads it to decide anything |
| D6 | A failed insert never changes the agent's answer. It is counted in `openokr_agent_tool_call_record_failures_total`, with no labels, and logged without the input | The answer is the product's promise and this row is bookkeeping. A write keeps its own audit row either way |
| D7 | Written in a frozen or read-only workspace too | The freeze governs writes (`operation.ts:589-603`). An agent hammering a frozen workspace is what an admin wants to see |
| D8 | **A3 ships first, alone.** It writes one workspace audit row for a scope refusal. A2 then writes its row in the same transaction as that audit row | A3 has no gate in the plan. The audit trail is the forever record of a security event; this table is an operational log with a retention |
| D9 | Only a scope refusal is audited. Every other refusal is a row here and nothing more | A scope refusal means the agent asked for more than its person granted. An unknown tool, a toolset or a bad input is a mistake, and a `can()` refusal writes no audit row in the browser either |
| D10 | No `ai_usage_events` row and no AI credit per tool call | The endpoint calls no provider (agent-surface.md §5.1), so there is no model, token or cost. This table is the count of agent calls |
| D11 | Retention: `agentToolCallRetentionDays` in `workspaces.settings`, default 90 (**Q2**). 0 keeps every row; otherwise at least 7 and at most 1825 | A busy agent makes thousands of calls a day. The table is new, so a default window deletes nothing anybody already had, unlike the message log's case |
| D12 | Swept by `connections.sweepToolCalls`: a pipeline write, `full`, `agentSurface: false`, scheduled daily at 04:20 UTC after the outbox purge, auditing the count and the window | The `channels.sweepMessageLog` shape. A retention delete is the deletion nobody watches, so its audit row is the evidence |
| D13 | The field sits on the admin card B10 builds for `messageLogRetentionDays` | One place for retention, and no setting without a screen (B10) |
| D14 | **A member sees their own**: the last 50 calls and the week's counts, beside each grant on `/account/connections` and each agent token on `/account/api-tokens`, through `connections.toolCalls`. It takes a grant or a token id and answers not-found for one that is not theirs | Their agent, their record, on the screens that already show its last use |
| D15 | **An admin with `full` sees totals** on the S-37 usage card: calls and refusals in the last 30 days and the five busiest tools, through `ai.readToolCallSummary`. No member is named | Another member's list is A4's question, which needs its own access design. Totals answer "are agents used, and refused" |
| D16 | Writes and scope refusals stay in the audit log screen | Unchanged, and A3 adds the refusals |
| D17 | Personal export: exported as "Calls your connected agents made". Erasure deletes the member's rows first and counts them in `removed.agentToolCalls` | A record of what somebody's agent read is about them. Their writes stay attributable in the audit trail, as for every erasure |
| D18 | Workspace archive: excluded | It names grants and tokens the receiving instance does not have, the reason `mcp_sessions` is excluded |
| D19 | Importer: no legacy source | Nothing in FlowyTeam or a spreadsheet records an agent's call to this instance |

## 2. The table

One migration, the next free number (0151 when this was written), with its policy:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` primary key | |
| `workspace_id` | `uuid not null`, references `workspaces` on delete cascade | The tenant floor |
| `member_id` | `uuid not null`, references `workspace_members` | Whom the agent acted as |
| `grant_id` | `uuid`, references `oauth_grants` on delete cascade | A hosted agent |
| `token_id` | `uuid`, references `api_tokens` on delete cascade | A local agent |
| `source` | `text not null default 'mcp'`, checked in `('mcp')` | Widened, as migration 0073 widened a check, when the copilot or agent runs record here |
| `tool` | `text` | The catalogue's name. Null for a tool this server does not have: that text is the agent's, and is not kept |
| `scope` | `text`, checked in `read`, `write`, `destructive` | What the tool needed at the time. Null with `tool` |
| `outcome` | `text not null`, checked against §2.1 | |
| `refusal_code` | `text`, checked in `forbidden`, `not_found`, `conflict` | The `OperationError` code, for `refused` only |
| `target_ids` | `uuid[] not null default '{}'`, at most five | D3 |
| `duration_ms` | `integer not null` | Around the dispatch |
| `called_at` | `timestamptz not null default now()` | |

- `check ((grant_id is null) <> (token_id is null))`: exactly one connection. Revisited when `source` widens.
- `-- openokr:hard-delete:` with its reason: retention removes rows and nothing restores them.
- `enable` and `force row level security`, and the `tenant_isolation` policy every table has, in the same migration.
- Indexes on `(workspace_id, member_id, called_at desc)` for the member's list and `(workspace_id, called_at)` for the sweep and the totals.

### 2.1 Outcomes

| Outcome | Where it stops |
|---|---|
| `ok` | The tool answered |
| `unknown_tool` | No such tool. `tool` and `scope` are null |
| `outside_toolsets` | The connection did not choose its toolset |
| `refused_scope` | The scope gate. A3's audit row is written in the same transaction |
| `invalid_input` | A server-set field, or the schema refused the input |
| `refused` | The action refused: not found, forbidden, a rule, a frozen workspace. `refusal_code` says which |
| `failed` | A fault |

## 3. Why not the pipeline, the outbox or `ai_usage_events`

| Way | What goes wrong |
|---|---|
| `runOperation` per call, as `recordUsageEvent` does | Every read becomes an activity row and an audit row. Audit rows are append-only and never pruned, so no retention could apply; the feed fills; and a frozen workspace refuses the operation, so a read there loses its record or fails |
| An outbox row the relay turns into a record | Two writes per call instead of one, later, and the relay would still insert outside a pipeline. The outbox carries side effects after a commit, and a read has no commit |
| An `ai_usage_events` row | `provider` and `model_id` are not null. Placeholders would put invented spend in the bill |
| **A marked insert (chosen)** | The standing `recordSessionFor` and the use stamps already have. Writes keep their atomic audit row, and scope refusals get one through A3 |

## 4. Open questions

**Q1.** D5 is an exception to "every write is one transaction through the Operation pipeline". The marker exists for this and the use stamps use it, but this is a new table written on every call. **Proposed: approve, with the reason in the marker and here.**

**Q2.** Retention default: 90 days, or keep forever (0, the message log's default)? **Proposed: 90.** Nothing exists to delete on upgrade, and a log nobody prunes outgrows its use.

**Q3.** AI-NATIVE-PLAN §7 lists the input, an output excerpt and `permission_checked`, and §8.1 says every call writes an audit event. This design keeps neither the input nor the output, records an outcome, and audits writes and scope refusals only. Both sections outrank this document. **Proposed: change §7 and §8.1 to match, in the same change.**

## 5. Acceptance criteria

- Given an agent token with read scope, when it calls `goals.read` with a goal's id, then one row holds `goals.read`, `read`, `ok`, that id, the token and the member, and no other input value.
- Given a grant with read and write, when it calls `goals.delete`, then one row holds `refused_scope`, and A3's scope-refusal audit row, naming the channel, commits with it.
- Given `search` with "Ali's salary review", when it answers, then the row holds `search` and `ok`, and those words are in no column.
- Given `goals.create` through a grant, when it succeeds, then one row holds `ok`, and the action's own audit row carries `channel: "mcp"` as today.
- Given an action that answers not-found, when an agent calls it, then the row holds `refused` and `not_found`, and the refusal sentence is in no column.
- Given an agent that names a tool called `drop table goals`, when it calls it, then the row holds `unknown_tool` and a null `tool`.
- Given a frozen workspace, when an agent reads a goal, then its row is written.
- Given an insert that fails, when an agent calls a tool, then it gets the same answer, and the failure counter rises by one.
- Given a retention of 30 and a row 31 days old, when the sweep runs, then the row is gone and one audit row records the count and the window. Given 0, nothing is deleted.
- Given Ana's grant, when Ben asks `connections.toolCalls` for it, then he gets not-found.
- Given an admin with `full`, when they open S-37, then the usage card shows calls, refusals and the five busiest tools, and names no member.
- Given rows in workspace B, when a member of A lists calls, then no row of B is returned.
- Given Ana is erased, when the erasure commits, then her rows are gone and `removed.agentToolCalls` counts them.

## 6. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/mcp-tool-calls.test.ts` | Target ids from an input, the outcome for each refusal |
| Integration | `packages/core/test/mcp-dispatch.test.ts` (existing) | Each outcome writes one row; no input value is stored; a failed insert leaves the answer alone |
| Integration | `packages/core/test/agent-tool-calls.test.ts` | The sweep, `connections.toolCalls` own-only, the summary, the tenant floor, erasure |
| Integration | `packages/core/test/people-export.test.ts`, `portability-policy.test.ts` (existing) | The table is classified |
| Integration | `packages/importer/test/mapping-coverage.test.ts` (existing) | The §7.2 row |
| End to end | `e2e/s41-mcp-transport.spec.ts` (extend) | A read and a refused call each leave a row; the refusal is audited |
| End to end | `e2e/s37c-mcp-agent-token.spec.ts` (extend) | The member sees the calls under their agent token |

## 7. Documents changed in the same change

- AI-NATIVE-PLAN §7 (the row), §8.1 (Limits and audit) and §4 (Usage and logs), per Q3.
- TECHNICAL-PLAN §4.14: `agentToolCallRetentionDays` in the defaults table.
- TECHNICAL-PLAN §7.2: `ai_tool_calls` joins the AI row with no legacy source.
- DATABASE.md §15: the row, built.
- agent-surface.md §5.2: "every call writes a tool-call row and an audit event" corrected.
- UIUX-PLAN S-37 (the usage card) and S-40 (the connections list).
- `docs/admin/settings.md`: the setting.
- `contract/*.json` regenerated: `connections.toolCalls`, `ai.readToolCallSummary`, `connections.sweepToolCalls` and `people.erase`'s output.
- A changeset.

## 8. What this does not do

- It does not record the copilot's or an agent run's tool calls. `agent_runs` keeps its own log; `source` is where they would join.
- It does not record REST or command-line calls. A token's last use stays the only trace of a read there.
- It does not show an admin another member's calls. That is A4.
- It does not price, cap or budget agent calls. `ai_budgets` is not consulted.
- It keeps no arguments, so no call can be replayed from it.
- It adds no command for `OPENOKR_SCHEDULER=off`. Rows are kept until a scheduler runs.
