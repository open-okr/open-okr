# Agent run log in the reader's language (D8)

Status: implemented. Design approved by the owner on 2026-11-23. Commit: . Known issue D8 from the 0.10.0 release checks (`docs/audits/release-0.10.0-checks.md`).

## 1. The problem

Every line of an agent run's log is stored as an English sentence and shown as stored.

| Where | What |
|---|---|
| Stored | `agent_runs.log jsonb`, an array of `AgentRunLogEntry` (`packages/db/src/schema/agents.ts:98`): `at`, `taskIndex`, `kind`, `message` |
| Written | `packages/agents/src/run-executor.ts`: the halt helper (around line 311) and the task step (around lines 441 to 530) build `message` with English template strings |
| Shown | `/admin/agents` (`apps/web/app/admin/agents/page.tsx:404`) renders `entry.message` as it is |

A member who reads Arabic sees "Proposed \"goals.update\" for review." in English. The sentence is fixed at write time, so no later change of language can reach it.

## 2. The decision asked for

Store what happened as a code with its values, beside the English sentence. Render the code through the catalogue when the page is drawn. Keep `message` as the English fallback.

| Option | Verdict |
|---|---|
| A. Add `code` and `values` to each new entry; render `t(code, values)`, fall back to `message` | **Recommended.** Additive, no migration, old entries still read |
| B. Translate at read time by matching the English sentence | Rejected: brittle, breaks when a sentence is reworded |
| C. Backfill codes into old entries | Rejected: a data change on stored rows for text nobody acts on; old runs keep English |

## 3. The shape

```ts
export interface AgentRunLogEntry {
  readonly at: string;
  readonly taskIndex: number;
  readonly kind: "denied" | "simulated" | "proposed" | "applied" | "error";
  readonly message: string;            // English, as today. Always written
  readonly code?: AgentRunLogCode;     // new, optional
  readonly values?: Readonly<Record<string, string | number>>; // new, optional
}
```

`log` is `jsonb`, so this is no migration. A reader from the previous release ignores the two new fields, so a rolling upgrade is safe (PLAN §5.1).

## 4. The codes

One catalogue key per code, `agents.runLog.<code>`, in all ten languages. The list is `AGENT_RUN_LOG_CODES` in `packages/db/src/schema/agents.ts`.

Implementation note: the step's `asAgent` helper writes two texts, one for a read and one for a direct write, so the read got its own code, `read`. Thirteen codes, not twelve.

| Code | Written where today | English (equal to today's `message`) | Values |
|---|---|---|---|
| `agentDisabled` | halt, `agent_disabled` | Stopped: this agent was turned off. | none |
| `aiUnavailable` | halt, `ai_unavailable` | Stopped: {reason} | `reason` |
| `costCap` | halt, `cost_cap` | Stopped: the cost cap for one run is {cap} US dollars and this run has spent {spent}. | `cap`, `spent` |
| `workspaceBudget` | halt, workspace cap | Halted: {reason} | `reason` |
| `agentBudget` | halt, agent cap | Halted: {reason} | `reason` |
| `noTask` | step | No task at the current index. | none |
| `unknownAction` | step | No action is called "{action}". | `action` |
| `denied` | step | Denied "{action}": {why} | `action`, `why` |
| `simulated` | step, sandbox | Simulated "{action}", sandbox mode commits nothing. | `action` |
| `proposed` | step, propose | Proposed "{action}" for review. | `action` |
| `read` | step, read action (any mode) | Read "{action}". | `action` |
| `applied` | step, direct write | Applied "{action}". | `action` |
| `failed` | step, error | "{action}" failed: {error} | `action`, `error` |

Two values are themselves sentences: `reason` (budget refusals from `packages/core/src/ai/budgets.ts`) and `error` (an `OperationError` message). They are passed through the same map the screens use for refusals (`apps/web/lib/error-messages.ts` and `operationMessage`), so a known sentence is translated and an unknown one stays as written. `action` stays the action's registry name, because it is a citation an administrator can look up.

Three sentence values are written by the executor itself rather than by the domain, so the error map does not hold them. They get their own keys, looked up before the error map (`apps/web/lib/agent-run-log.ts`), and English equal to the stored text:

| Key | Value it translates |
|---|---|
| `agents.runLog.reason.noAccess` | `why` of `denied` |
| `agents.runLog.reason.noProvider` | `reason` of `aiUnavailable`, no provider for the tier |
| `agents.runLog.reason.privacy` | `reason` of `aiUnavailable`, egress blocked |

The budget refusals from `budgets.ts` are not in the error map, so they stay English inside the translated `workspaceBudget` and `agentBudget` lines.

Current wording note: the stored `simulated` sentence uses an em dash. The catalogue's English value replaces it with a comma; the stored `message` keeps whatever the code writes.

## 5. Rendering

`/admin/agents` renders `entry.code ? t("agents.runLog." + entry.code, values) : entry.message`, through `runLogText` in `apps/web/lib/agent-run-log.ts`. A code this release does not know also falls back to `message`. Nothing else reads the log as text for a person. The API returns the entry as stored, now with the two optional fields: `agents.startRun` and `agents.readRun` (the shared run output) and `agents.listRuns`, which the contract regeneration shows.

Only the custom-run executor writes codes. The Coach's and the Champion's own log lines (`packages/core/src/actions/agents.ts`, the `log.push` sites) carry no code and are shown in English as before.

## 6. What does not change

- No migration, no backfill, no change to stored rows.
- `message` is still written in English on every entry, for the audit trail and for API clients.
- The audit and activity payloads (`outcome: kind`) are unchanged.

## 7. Acceptance

| Given | When | Then |
|---|---|---|
| A run in sandbox mode for a member whose language is `ar` | The admin opens `/admin/agents` | The simulated line reads in Arabic, with the action name as written |
| A run stored before this change (no `code`) | The admin opens `/admin/agents` in `id` | The line shows the stored English `message`, unchanged |
| A task that fails with "No such goal." | The run log is shown in `id` | The line reads the Indonesian refusal from the error map inside the translated `failed` sentence |
| The contract is regenerated | `pnpm check:contract` | `agents.startRun`, `agents.readRun` and `agents.listRuns` list `code` and `values` as optional; nothing else moved |
| Any code | `pnpm i18n:check` | `agents.runLog.<code>` exists in all ten catalogues with matching holes |

## 8. Size

One package write site (`run-executor.ts`), the schema type, one screen, ten catalogues, the contract and its tests. One change, one commit.
