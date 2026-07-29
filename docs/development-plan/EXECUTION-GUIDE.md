# EXECUTION-GUIDE.md

How a human engineer and Claude Code execute IMPLEMENTATION-PLAN.md together, one task at a time, in this repository.

Read this once before starting. After that, you only need section 3 (the task loop) day to day.

---

## 1. Roles

| Who | Responsible for |
|---|---|
| Human engineer | Picks the next task, reviews and merges every PR, approves design gates and spike go/no-gos, answers the agent's questions, owns all credentials and deployments, re-baselines the plan when throughput drifts |
| Claude Code agent | Executes one task at a time: test plan first, then code, then QA. Updates STATUS.md. Opens one PR per task. Stops and asks when blocked |

Two rules that keep this safe:

1. The agent never merges its own PRs. A human merges.
2. The agent never starts a task the human did not name. No self-directed scope.

## 2. First-run sanity check

The plan lives in `docs/development-plan/`; `CLAUDE.md` (copied to the repo root of the build repo) is auto-loaded. Before the first task:

1. Verify `STATUS.md` is present with all **93 tasks** set to `todo`.
2. Open Claude Code at the repo root and paste:

> **Bootstrap prompt**
> Read CLAUDE.md, then docs/development-plan/REQUIREMENTS.md, PLAN.md, TECHNICAL-PLAN.md, AI-NATIVE-PLAN.md, UIUX-PLAN.md, IMPLEMENTATION-PLAN.md and EXECUTION-GUIDE.md. Skim OPERATELY-COMPARISON.md so you know why the plan is shaped this way. Do not write any code. Reply with: (1) a one-paragraph summary of what we are building, (2) the first task ID you would execute and why, (3) any contradiction or ambiguity you found across the documents. Then stop.

3. Fix any real contradiction it finds (edit the docs, commit). When the reply is clean, start `P1-T01`.

## 3. The task loop

One task, one branch, one PR.

```
human picks task -> agent restates plan -> human confirms -> agent: tests -> code -> QA
      -> agent opens PR + updates STATUS.md -> human reviews -> merge (or rework) -> next task
```

### Step 1. Human starts a task

Pick the next task whose `Depends on` entries are all `done` in STATUS.md. Paste:

> **Start-task prompt**
> Execute task `<TASK-ID>` from docs/development-plan/IMPLEMENTATION-PLAN.md. First restate the task in your own words: goal, deliverables, test plan, and anything unclear, and confirm the Definition of Ready holds. Do not write code yet. Wait for my confirmation.

Note: every task's full body lives in IMPLEMENTATION-PLAN.md, except Phase 5 (`P5-*`), whose bodies are in AI-NATIVE-PLAN.md §12. The loop is identical.

### Step 2. Agent restates, human confirms

The agent replies with its understanding and any questions. If the restatement is wrong, correct it now — it is the cheapest moment to fix a misunderstanding. Then reply `Confirmed, proceed`.

### Step 3. Agent executes

1. **Test plan.** Write the task's tests first; new tests must fail before the implementation exists (red), except pure scaffolding. Test setup goes through the `test-support` factory (core services, never raw inserts).
2. **Development.** Implement until green. Follow every hard rule in CLAUDE.md (Operation pipeline, access getter, RLS-with-migration, outbox-only enqueue, Zod, strict TS).
3. **QA.** Run the task's QA checklist, `pnpm typecheck`, `pnpm lint`, the full affected suite, and exercise the feature in the running app when the checklist says so.

### Step 4. Agent reports

1. Set the STATUS.md row to `in_review` with the branch name and date.
2. Commit on `task/<task-id-lowercase>-<short-slug>` (e.g. `task/p3-t06-check-ins`).
3. Open a PR titled `<TASK-ID>: <task title>` containing: the task ID, what was done, the CLAUDE.md Definition of Done checklist with each box ticked or explained, test evidence, and any deviations from the task text.
4. Stop. Do not start another task.

If CI or tests fail beyond the task's scope, set the task to `blocked`, describe the blocker, and stop.

### Step 5. Human reviews

Use the checklist in section 7. Outcomes: **approve and merge** (set the row `done`), or **request changes**:

> **Rework prompt**
> Rework task `<TASK-ID>`. Address these review comments: `<comments>`. Do not change anything outside the scope of these comments. Update the PR when done and stop.

### Step 6. Next task

Return to step 1. One task at a time per working copy; for parallelism see §6.

## 4. Phase gates, design gates, and spikes

- The eight phases run **strictly in sequence** (Phase 2 on Phase 1, and so on). Within a phase, per-task `Depends on` rules the order.
- Before a phase's first task: the human checks the previous phase is `done`, and the agent runs that phase's exit checklist and reports results.
- **Design gates** (`P3-T00`, `P4-T00`, `P5-T00`) produce `docs/design/*` docs and require the explicit reply `Design approved for Phase <n>` before that phase's implementation tasks start. The P3-T00 golden-master matrices get a line-by-line human review — they are the correctness contract for the engines.
- **Spikes** (`P1-T03`, and any task marked `[SPIKE]`) end in a written go/no-go against their PLAN.md §13 risk-register row. A "no-go" invokes that row's documented fallback — it is not a failure, it is the plan working.

## 5. STATUS.md rules

- One row per task, statuses: `todo`, `in_progress`, `in_review`, `blocked`, `done`, `skipped` (skipped requires a note and human sign-off).
- Append-only in spirit: never delete rows, never rewrite history in Notes.
- Every status change is one commit (may ride the task branch). If STATUS.md and reality disagree, reality wins; fix it in the same PR.

## 6. Throughput, parallelism, and re-baselining

- **Planning assumption (PLAN.md §12):** one human reviewer + the agent sustain **3–5 merged tasks per week** (L tasks count double). Phases 1–6 ≈ 6–9 months. Review time is the rate limiter — budget 10–30 minutes per task.
- **Parallel tracks are allowed** for tasks with no dependency edge and no shared files, using separate git worktrees/sessions (e.g. P2-T05 files alongside P2-T04 invitations). Never run two tasks in one working copy. Merge order follows the dependency graph.
- **Re-baseline, don't slip:** if actual throughput diverges from the assumption by more than ±50% over a month, stop and re-baseline — cut Phase 4 scope before Phase 3 scope (PLAN.md §13 R6), or split tasks. A silent slip is the only unacceptable outcome.

## 7. Human review checklist per PR

- [ ] Acceptance criteria met — walk each Given/When/Then yourself or via the e2e output.
- [ ] CI green (affected-graph run; flakiness report shows no new quarantine candidates).
- [ ] Definition of Done checklist in the PR description is complete and honest.
- [ ] New tables ship `workspace_id` + an RLS policy in the same migration; protected aggregates get an access context + bindings in their creation Operation.
- [ ] Writes go through the Operation pipeline (audit + outbox in-transaction); reads through the access getter. Spot-check the diff for ad-hoc queries or direct driver calls.
- [ ] No vendor SDK import outside `packages/adapters`.
- [ ] External inputs Zod-validated; rich text through the shared core module.
- [ ] If the schema changed: the FlowyTeam mapping (TECHNICAL-PLAN.md §7.2) updated in the same PR (or "new, no legacy source" noted); DATABASE.md updated.
- [ ] If the action registry changed: contract projections regenerated, drift check green.
- [ ] STATUS.md row updated. No secrets, no unjustified `any`, no unapproved dependency.

## 8. When the agent must stop and ask

- Acceptance criteria are ambiguous or contradict another document.
- A task needs a new runtime dependency, or a power-floor item (REQUIREMENTS §6) seems needed in v1.
- Anything in the CLAUDE.md "Ask the human" list.
- A spike is trending no-go.
- Two consecutive rework rounds have failed. Do not grind; escalate with a written summary of what was tried.

## 9. Failure and rework handling

- A task that keeps failing is a signal the task is cut wrong. The human may split it (`<TASK-ID>a`, `<TASK-ID>b` added to IMPLEMENTATION-PLAN.md with a note) rather than letting one PR balloon.
- Reverts are normal: revert PR first, then fix forward. Keep main releasable at all times.
- Never rewrite a shipped migration. Forward-only, always; data reshaping goes through the data-change runner (P2-T13).

## 10. Session hygiene for the agent

- One task per session where practical. Long sessions drift.
- Start every session by reading: CLAUDE.md (automatic), STATUS.md, and the current task's text. Small tasks need nothing else.
- If a session ends mid-task, leave STATUS.md at `in_progress` with a Notes entry saying exactly where it stopped.

## 11. Worked example

1. Human: STATUS.md shows `P3-T05 done`. Next eligible is `P3-T06`. Paste the start-task prompt.
2. Agent: restates — "Goal: check-ins as immutable snapshot bundles with draft/publish and reviewer acknowledgement… Tests: draft emits no side effects; publish snapshots + advances cadence + creates the reviewer obligation; delete rolls pointers back. Question: does the edit window apply to drafts?" Human: "Drafts are freely editable; the window applies after publish. Confirmed, proceed."
3. Agent: writes failing tests, implements, runs QA, updates STATUS.md to `in_review`, opens `P3-T06: Check-ins: snapshots, draft/publish, acknowledgement`, stops.
4. Human: reviews with §7, merges, sets `done`. Repeat with `P3-T07`.

Total human time per small task is typically 10–20 minutes of review. That is the monitoring cost this process is designed around — and the §6 throughput math is built on it.
