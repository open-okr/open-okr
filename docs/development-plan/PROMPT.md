# PROMPT.md

Copy-paste prompts for running OpenOKR development with Claude Code, plus how it finds the plan. Day to day you only ever name a task ID; Claude pulls in everything else itself.

---

## How Claude Code refers to the plan

`CLAUDE.md` (auto-loaded from the repo root of the build repo) names the whole document set, the authority order, the hard rules, and the task loop — you never paste the doc list.

## Main reference documents (the order Claude uses them)

| For… | Claude reads |
|---|---|
| Every session (automatic) | `CLAUDE.md` — rules + authority order |
| What to do next | `STATUS.md` — the next `todo` whose dependencies are `done` |
| What a task means | `IMPLEMENTATION-PLAN.md` — the task body (Phase 5 `P5-*` bodies are in `AI-NATIVE-PLAN.md §12`) |
| Per-task spec authority | UI → `UIUX-PLAN.md` (S-xx) · schema → `TECHNICAL-PLAN.md §4` (+ §7.2 mapping) · engines → `TECHNICAL-PLAN.md §6` · AI → `AI-NATIVE-PLAN.md` · importer → `reference/flowyteam-okr-kpi-tasks-model.md` |
| Why the plan is shaped this way | `OPERATELY-COMPARISON.md` (background, not authority) |

## Two rules that keep it safe

1. **You pick the task, one at a time.** Claude never starts the next one on its own. After a merge, set the STATUS.md row to `done` (or ask Claude to) and start the next.
2. **You review and merge every PR.** Claude opens the PR and stops.

A typical turn: check STATUS.md → paste prompt 2 with the next eligible task ID → reply `Confirmed, proceed` → review the PR.

---

## The prompts

### 1. Once per repo — bootstrap / sanity check

> Read CLAUDE.md, then docs/development-plan/REQUIREMENTS.md, PLAN.md, TECHNICAL-PLAN.md, AI-NATIVE-PLAN.md, UIUX-PLAN.md, IMPLEMENTATION-PLAN.md and EXECUTION-GUIDE.md. Skim OPERATELY-COMPARISON.md so you know why the plan is shaped this way. Do not write any code. Reply with: (1) a one-paragraph summary of what we are building, (2) the first task ID you would execute and why, (3) any contradiction or ambiguity you found. Then stop.

### 2. Start a task (the everyday prompt — swap the ID)

> Execute task `P1-T01` from docs/development-plan/IMPLEMENTATION-PLAN.md. First restate the task in your own words — goal, deliverables, test plan, and anything unclear — and confirm the Definition of Ready holds. Do not write code yet. Wait for my confirmation.

### 3. After it restates correctly — unblock it

> Confirmed, proceed.

If the restatement is wrong, correct it here instead — the cheapest moment to fix a misunderstanding.

### 4. Resume a session that ended mid-task

> Check STATUS.md for the task marked `in_progress` and read its Notes. Restate where it stopped and what remains, then continue that task from there. Do not start any other task.

### 5. Rework after your PR review

> Rework task `P1-T01`. Address these review comments: `<paste comments>`. Do not change anything outside the scope of these comments. Update the PR when done and stop.

### 6. Run a design gate (once per phase that has one: P3-T00, P4-T00, P5-T00)

> Execute the design-gate task `P3-T00`. Produce the design docs it names. Do not start any implementation task. When done, stop and wait for my review.

Then, to approve:

> Design approved for Phase 3.

### 7. Review a spike result (P1-T03 and any task marked [SPIKE])

> Summarize the spike's findings against its PLAN.md §13 risk-register row and recommend go or no-go with the fallback spelled out. Do not proceed until I reply with the decision.

---

## Notes

- Task IDs run `P1-*` (walking skeleton) through `P8-*` (community launch), 93 tasks, strategy-first (Phase 3 = the OKR/rhythm core, Phase 4 = execution). Full index: IMPLEMENTATION-PLAN.md appendix A; the deferred power floor is appendix B.
- Each phase gates on the previous one; per-task dependencies still apply (EXECUTION-GUIDE.md §4). Parallel worktrees are allowed for independent tasks (§6).
- If Claude is blocked, it sets the task to `blocked` in STATUS.md and asks. Answer, then it resumes.
- Full protocol: EXECUTION-GUIDE.md. Agent rules: CLAUDE.md.
