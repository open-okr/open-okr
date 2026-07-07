# EXECUTION-GUIDE.md

How a human engineer and Claude Code execute IMPLEMENTATION-PLAN.md together, one task at a time, in this repository.

Read this once before starting. After that, you only need section 3 (the task loop) day to day.

---

## 1. Roles

| Who | Responsible for |
|---|---|
| Human engineer | Picks the next task, reviews and merges every PR, approves phase gates, answers the agent's questions, owns all credentials and deployments |
| Claude Code agent | Executes one task at a time: test plan first, then code, then QA. Updates STATUS.md. Opens one PR per task. Stops and asks when blocked |

Two rules that keep this safe:

1. The agent never merges its own PRs. A human merges.
2. The agent never starts a task the human did not name. No self-directed scope.

## 2. First-run sanity check

This repository already holds the plan: the document set is in `docs/development-plan/` and `CLAUDE.md` sits at the repo root, where Claude Code reads it automatically. Before the first task, run the bootstrap check once:

1. Verify `docs/development-plan/STATUS.md` is present. It ships pre-filled with all 109 tasks set to `todo` (regenerate from the template in section 5 only if it is missing).
2. Open Claude Code at the repo root and paste the bootstrap prompt:

> **Bootstrap prompt**
> Read CLAUDE.md, then docs/development-plan/REQUIREMENTS.md, PLAN.md, TECHNICAL-PLAN.md, AI-NATIVE-PLAN.md, UIUX-PLAN.md, IMPLEMENTATION-PLAN.md and EXECUTION-GUIDE.md. Do not write any code. Reply with: (1) a one-paragraph summary of what we are building, (2) the first task ID you would execute and why, (3) any contradiction or ambiguity you found across the documents. Then stop.

3. Read the agent's reply. Fix any real contradiction it found (edit the docs, commit). When the reply is clean, you are ready for the first task.

## 3. The task loop

Every task in IMPLEMENTATION-PLAN.md follows the same loop. One task, one branch, one PR.

```
human picks task -> agent restates plan -> human confirms -> agent: tests -> code -> QA
      -> agent opens PR + updates STATUS.md -> human reviews -> merge (or rework) -> next task
```

### Step 1. Human starts a task

Pick the next task whose `Depends on` entries are all `done` in STATUS.md. Paste:

> **Start-task prompt**
> Execute task `<TASK-ID>` from docs/development-plan/IMPLEMENTATION-PLAN.md. First restate the task in your own words: goal, deliverables, test plan, and anything unclear. Do not write code yet. Wait for my confirmation.

Note: every task's full body (deliverables, test plan, development, QA, acceptance) lives in IMPLEMENTATION-PLAN.md, except the Phase 5 AI tasks (`P5-*`), whose bodies are in AI-NATIVE-PLAN.md §12 (IMPLEMENTATION-PLAN.md holds the index row for those). The loop is otherwise identical.

### Step 2. Agent restates, human confirms

The agent replies with its understanding and any questions. If the restatement is wrong, correct it now. It is the cheapest moment to fix a misunderstanding. Then reply `Confirmed, proceed`.

### Step 3. Agent executes

The agent works through the task's three blocks in order, as written in the implementation plan:

1. **Test plan.** Write the tests described in the task first. New tests must fail before the implementation exists (red), except pure scaffolding tasks.
2. **Development.** Implement until the tests pass. Follow every hard rule in CLAUDE.md (adapters, RLS, Zod, strict TypeScript).
3. **QA.** Run the task's QA checklist: typecheck, lint, full test suite in both runtime profiles, and manually exercise the feature via the running app when the checklist says so.

### Step 4. Agent reports

When the task is done the agent must, in this order:

1. Set the task row in STATUS.md to `in_review` with the branch name and date.
2. Commit on a branch named `task/<task-id-lowercase>-<short-slug>` (example: `task/p3-t04-wp-crud`).
3. Open a PR titled `<TASK-ID>: <task title>`. The PR description must contain: the task ID, what was done, the Definition of Done checklist from CLAUDE.md with each box ticked or explained, test evidence (test names and counts), and any deviations from the task text.
4. Stop. The agent does not start another task.

If CI or tests fail and the agent cannot fix them within the task's scope, it sets the task to `blocked` in STATUS.md, describes the blocker in the PR or chat, and stops.

### Step 5. Human reviews

Use the checklist in section 7. Outcomes:

- **Approve and merge.** Set the STATUS.md row to `done` (the agent can do this housekeeping if you ask).
- **Request changes.** Paste review comments to the agent:

> **Rework prompt**
> Rework task `<TASK-ID>`. Address these review comments: `<comments>`. Do not change anything outside the scope of these comments. Update the PR when done and stop.

### Step 6. Next task

Return to step 1. One task at a time. Do not run two tasks in parallel in the same working copy; if you want parallelism, use separate worktrees/sessions and only for tasks with no shared files and no dependency between them.

## 4. Phase gates

The eight phases run **strictly in sequence** — each phase gates on the one before it (Phase 2 on Phase 1, Phase 3 on Phase 2, and so on; see IMPLEMENTATION-PLAN.md). Within a phase, per-task `Depends on` entries still rule the task order. Before the first task of each phase:

1. The human checks every task of the previous phase is `done` in STATUS.md.
2. The agent runs the phase-exit checklist at the end of that phase's section in IMPLEMENTATION-PLAN.md and reports results.
3. Any phase that has a `Design gate` task (writing or updating docs in `docs/design/`) requires explicit human approval of those docs before implementation tasks of that phase start. Reply with `Design approved for Phase <n>` so the approval is on record in the chat.

## 5. STATUS.md template

Create `docs/development-plan/STATUS.md` with this content. One row per task, copied from IMPLEMENTATION-PLAN.md. Statuses: `todo`, `in_progress`, `in_review`, `blocked`, `done`, `skipped` (skipped requires a note and human sign-off).

```markdown
# STATUS.md

Single source of truth for execution progress. The agent updates rows; a human is the only one who sets `done`.

Last updated: <date> by <human|agent>

## Phase 1

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P1-T01 | ... | todo |  |  |  |

## Phase 2

| Task | Title | Status | Branch / PR | Updated | Notes |
|---|---|---|---|---|---|
| P2-T01 | ... | todo |  |  |  |
```

Rules:

- STATUS.md is append-only in spirit: never delete rows, never rewrite history in Notes.
- Every status change is one commit (it may ride along with the task branch).
- If STATUS.md and reality disagree, reality wins; fix STATUS.md in the same PR.

## 6. Branch, commit and PR conventions

| Item | Convention | Example |
|---|---|---|
| Branch | `task/<task-id>-<slug>` | `task/p2-t03-audit-log` |
| Commit subject | `<TASK-ID>: imperative summary` under 72 chars | `P2-T03: add append-only audit_events table` |
| PR title | `<TASK-ID>: <task title>` | `P2-T03: Audit log foundation` |
| PR base | `main` | |
| Merge | Human merges. Squash is fine; keep the task ID in the squash title | |

## 7. Human review checklist per PR

- [ ] Acceptance criteria of the task are met. Walk through each Given/When/Then yourself or via the e2e test run output.
- [ ] CI is green in both runtime profiles (`RUNTIME=container` and `RUNTIME=serverless`).
- [ ] Definition of Done checklist in the PR description is complete and honest.
- [ ] New tables ship `workspace_id` and an RLS policy in the same migration.
- [ ] No vendor SDK import outside `packages/adapters`. Spot-check the diff.
- [ ] External inputs validated with Zod at the boundary.
- [ ] If the schema changed: the source-to-target mapping table in `docs/development-plan/TECHNICAL-PLAN.md` (§7) was updated in the same PR.
- [ ] STATUS.md row updated.
- [ ] No secrets, no `any` without a justifying comment, no new runtime dependency that was not approved.

## 8. When the agent must stop and ask

The agent stops and asks a human (and sets `blocked` if mid-task) when:

- Acceptance criteria are ambiguous or contradict another document.
- A task needs a new runtime dependency.
- A feature cannot work in both runtime profiles.
- Anything in the CLAUDE.md "Ask the human" list comes up.
- Two consecutive rework rounds have failed. Do not grind; escalate with a written summary of what was tried.

## 9. Failure and rework handling

- A task that keeps failing is a signal the task is cut wrong. The human may split it: add sub-tasks `<TASK-ID>a`, `<TASK-ID>b` to IMPLEMENTATION-PLAN.md with a note, rather than letting one PR balloon.
- Reverts are normal: if a merged task turns out broken, open a revert PR first, then a fix-forward task. Keep main releasable at all times.
- Never rewrite a shipped migration. Forward-only, always (CLAUDE.md hard rule).

## 10. Session hygiene for the agent

- One task per Claude Code session where practical. Long sessions drift.
- Start every session by reading: root CLAUDE.md (automatic), STATUS.md, and the current task's text. Nothing else is required reading for small tasks.
- The agent should not re-read the entire plan set every session; the docs are stable, the task text is the contract.
- If the session ends mid-task, the agent leaves STATUS.md at `in_progress` with a Notes entry saying exactly where it stopped, so the next session can resume.

## 11. Worked example

A realistic run of one task, so the rhythm is clear:

1. Human: STATUS.md shows `P2-T02 done`. Next eligible is `P2-T03` (depends on P2-T02). Paste the start-task prompt with `P2-T03`.
2. Agent: restates: "Goal: append-only audit_events table plus core write API... Tests: unit for the writer service, integration for RLS isolation, one e2e asserting an audit row after a sensitive action. Question: should reads be admin-only in this task or later?" Human: "Admin-only later, this task is write path only. Confirmed, proceed."
3. Agent: writes failing tests, implements, runs `pnpm typecheck && pnpm lint && pnpm test` under both profiles, does the QA checklist, updates STATUS.md to `in_review`, opens PR `P2-T03: Audit log foundation`, stops.
4. Human: reviews with the section 7 checklist, merges, sets `done`.
5. Repeat with `P2-T04`.

Total human time per small task is typically 10 to 20 minutes of review. That is the monitoring cost this process is designed around.
