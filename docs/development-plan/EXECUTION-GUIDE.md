# EXECUTION-GUIDE.md

How a human engineer and Claude Code execute IMPLEMENTATION-PLAN.md together, one task at a time.

Read this once before starting. After that, section 3 is the only part you need day to day.

---

## 1. Roles

| Who | Responsible for |
|---|---|
| Human engineer | Picks the next task, reviews and merges every change, approves design gates and spike decisions, answers the agent's questions, owns all credentials and deployments, re-baselines the plan when throughput drifts |
| Claude Code agent | Executes one task at a time: tests first, then code, then quality checks. Updates STATUS.md. Opens one change per task. Stops and asks when blocked |

Two rules keep this safe:

1. The agent never merges its own work. A human merges.
2. The agent never starts a task the human did not name. No self-directed scope.

## 2. First run

The plan lives in `docs/development-plan/`. `CLAUDE.md` at the repository root is loaded automatically. Before the first task:

1. Check that STATUS.md is present with all 105 tasks set to `todo`.
2. Open Claude Code at the repository root and paste the bootstrap prompt from PROMPT.md §1.
3. Fix any real contradiction it finds by editing the documents and committing. When the reply is clean, start `P1-T01`.

## 3. The task loop

One task, one branch, one change request, **one working session and one commit**.

That is the unit. A task is cut to fit it before anybody starts, not squeezed
into it afterwards. `IMPLEMENTATION-PLAN.md` carries no task larger than one
session in the phases still ahead; where the original cut was bigger, the task
is split into lettered parts and the letters are the tasks.

If the agent gets partway in and finds the task will not fit, it stops before
writing more code and proposes the split. Four commits under one task identifier
reads as progress on a review screen while nothing in it is finishable, and the
next person inherits a size that was already known to be wrong.

```
human picks a task -> agent restates the plan -> human confirms
   -> agent: tests -> code -> quality checks
   -> agent opens the change and updates STATUS.md
   -> human reviews -> merge or rework -> next task
```

### Step 1. The human starts a task

Pick the next task whose dependencies are all `done` in STATUS.md, then paste the session prompt from START-PROMPT.md with that task identifier. Leaving the task line out makes the agent propose the next eligible task for you to confirm.

### Step 2. The agent restates, the human confirms

The agent replies with its understanding and any questions. If the restatement is wrong, correct it now. It is the cheapest moment to fix a misunderstanding. Then reply "confirmed, proceed".

### Step 3. The agent executes

1. **Tests.** Write the task's tests first. New tests must fail before the implementation exists, except for pure scaffolding. Setup goes through the test-support factory, calling core services rather than inserting rows directly.
2. **Development.** Implement until green, following every hard rule in CLAUDE.md.
3. **Quality checks.** Run type checking, linting and the affected suites, and exercise the feature in the running application where the task calls for it.

### Step 4. The agent reports

1. Set the STATUS.md row to `in_review` with the branch name and date.
2. Commit on a branch named `task/<task-id-lowercase>-<short-slug>`.
3. Open a change request titled `<TASK-ID>: <task title>` containing the task identifier, what was done, the Definition of Done checklist with every box ticked or explained, test evidence, and any deviation from the task text.
4. Stop. Do not start another task.

If tests or continuous integration fail beyond the task's scope, set the task to `blocked`, describe the blocker, and stop.

### Step 5. The human reviews

Use the checklist in §7. The outcome is either approve and merge, setting the row to `done`, or request changes with the rework prompt from PROMPT.md §5.

### Step 6. Next task

Return to step 1. One task at a time per working copy. For parallel work see §6.

## 4. Phases, design gates and spikes

- The eight phases run strictly in sequence. Within a phase, each task's dependencies rule the order.
- Before a phase's first task, the human checks the previous phase is complete, and the agent runs that phase's exit checklist and reports the result.
- **Design gates** are P3-T00, P4-T00, P5-T00 and P8-T01. Each produces design documents and requires the explicit reply "design approved for phase N" before any implementation task in that phase starts. Two artifacts get a line-by-line human review because they are correctness contracts: the golden-master matrices at P3-T00, and the rule corpus and trigger catalogue at P4-T00.
- **Spikes** end in a written decision against their risk-register row in PLAN.md §12. A negative result invokes that row's documented fallback. That is the plan working, not a failure.

## 5. STATUS.md rules

- One row per task. Statuses are `todo`, `in_progress`, `in_review`, `blocked`, `done` and `skipped`. Skipping requires a note and human sign-off.
- Never delete a row and never rewrite history in the notes column.
- Every status change is one commit, which may ride the task branch. If STATUS.md and reality disagree, reality wins, and the file is corrected in the same change.

## 6. Throughput and parallel work

- **The planning assumption:** one human reviewer plus the agent sustain three to five merged tasks per week. Since a task is one session, the count is the throughput; there is no doubling for large tasks any more, because there are none in the phases ahead. Phases 1 to 7 take roughly seven to ten months. Review time is the limiting factor, so budget ten to thirty minutes per task.
- **Parallel tracks are allowed** for tasks with no dependency edge and no shared files, using separate worktrees and sessions. Never run two tasks in one working copy. Merge order follows the dependency graph.
- **Re-baseline rather than slip.** If actual throughput diverges from the assumption by more than half over a month, stop and re-baseline. Cut Phase 5 scope before Phase 4 scope. A silent slip is the only unacceptable outcome.

## 7. Review checklist

- [ ] Acceptance criteria met. Walk each Given / When / Then yourself or through the test output.
- [ ] Continuous integration is green, and the flakiness report shows no new quarantine candidates.
- [ ] The Definition of Done checklist in the change description is complete and honest.
- [ ] New tables carry the tenant key and a row-level security policy in the same migration. Protected aggregates get an access context and bindings inside their creation Operation.
- [ ] Writes go through the Operation pipeline with audit and outbox in the same transaction. Reads go through the access getter. Spot-check the change for ad-hoc queries or direct driver calls.
- [ ] No vendor SDK imported outside the adapters package.
- [ ] External inputs validated at the boundary. Rich text goes through the shared module.
- [ ] Any rule, threshold, band, corridor or taxonomy touched matches METHOD.md, and the conformance suite passes.
- [ ] Any new setting is in the TECHNICAL-PLAN.md §4.14 map with a default, and no screen blocks until it is chosen.
- [ ] If the schema changed: the importer mapping in TECHNICAL-PLAN.md §7.2 is updated in the same change, or the table is marked as having no legacy source. DATABASE.md is updated.
- [ ] If the action registry changed: the generated projections are regenerated and the drift check is green.
- [ ] If a proactive message was added: it has a rule key, a nudge record, deduplication, an escalation position and a snooze path.
- [ ] STATUS.md row updated. No secrets, no unjustified loose types, no unapproved dependency.

## 8. When the agent must stop and ask

- Acceptance criteria are ambiguous or contradict another document.
- A task needs a new runtime dependency, or a deferred item from REQUIREMENTS.md §9 seems necessary in v1.
- Anything on the "ask the human" list in CLAUDE.md.
- A rule, threshold or coaching message would need to change in METHOD.md.
- A spike is trending toward a negative result.
- Two consecutive rework rounds have failed. Do not grind. Escalate with a written summary of what was tried.

## 9. Failure and rework

- A task that keeps failing is a signal that the task is cut wrong. The human may split it, adding the split to IMPLEMENTATION-PLAN.md with a note, rather than letting one change balloon.
- Reverts are normal. Revert first, then fix forward. Keep the main branch releasable at all times.
- Never rewrite a shipped migration. Forward-only, always. Data reshaping goes through the data-change runner.

## 10. Session hygiene

- One task per session where practical. Long sessions drift.
- Start every session by reading CLAUDE.md (automatic), STATUS.md and the current task's text. Small tasks need nothing else.
- If a session ends mid-task, leave STATUS.md at `in_progress` with a note saying exactly where it stopped.

## 11. Worked example

1. The human sees `P3-T06` is done. The next eligible task is `P3-T07`. They paste the start-task prompt.
2. The agent restates: "Goal: check-ins as immutable snapshot bundles with draft and publish, reviewer acknowledgement and private team voting. Tests: a draft emits no side effects, publishing snapshots values and advances the cadence and creates the reviewer obligation, deletion rolls pointers back, votes stay hidden until the reveal. Question: does the edit window apply to drafts?" The human answers: "Drafts are freely editable. The window applies after publishing. Confirmed, proceed."
3. The agent writes failing tests, implements, runs the quality checks, sets STATUS.md to `in_review`, opens the change and stops.
4. The human reviews with §7, merges, and sets the row to `done`. Then starts `P3-T08`.

Total human time per small task is typically ten to twenty minutes of review. That is the cost this process is designed around, and the §6 throughput assumption is built on it.
