# PROMPT.md

Copy-paste prompts for running OpenOKR development with Claude Code, plus how it finds the plan. Day to day you only ever name a task ID; Claude pulls in everything else itself.

---

## How Claude Code refers to the plan

`CLAUDE.md` at the **repo root** is auto-loaded every session. It names the whole document set, the authority order, the hard rules, and the task loop, so you never paste the doc list — Claude reads it and follows the pointers.

## Main reference documents (the order Claude uses them)

| For… | Claude reads |
|---|---|
| Every session (automatic) | `CLAUDE.md` (root) — rules + authority order |
| What to do next | `STATUS.md` — pick the next `todo` whose dependencies are `done` |
| What a task means | `IMPLEMENTATION-PLAN.md` — the task body (for Phase 5 `P5-*` tasks the body is in `AI-NATIVE-PLAN.md §12`) |
| Per-task spec authority | UI → `UIUX-PLAN.md` (S-xx) · schema → `TECHNICAL-PLAN.md §4` (strategy: §4.12) · importer → `reference/*` |

## Two rules that keep it safe

1. **You pick the task, one at a time.** Claude never starts the next one on its own. After a task merges, set its STATUS.md row to `done` (or ask Claude to) and start the next.
2. **You review and merge every PR.** Claude opens the PR and stops; it never merges its own work.

A typical turn: check STATUS.md → paste prompt 2 with the next eligible task ID → reply `Confirmed, proceed` → review the PR.

---

## The prompts

### 1. Once per repo — bootstrap / sanity check

> Read CLAUDE.md, then docs/development-plan/REQUIREMENTS.md, PLAN.md, TECHNICAL-PLAN.md, AI-NATIVE-PLAN.md, UIUX-PLAN.md, IMPLEMENTATION-PLAN.md and EXECUTION-GUIDE.md. Do not write any code. Reply with: (1) a one-paragraph summary of what we are building, (2) the first task ID you would execute and why, (3) any contradiction or ambiguity you found. Then stop.

### 2. Start a task (the everyday prompt — swap the ID)

> Execute task `P1-T01` from docs/development-plan/IMPLEMENTATION-PLAN.md. First restate the task in your own words — goal, deliverables, test plan, and anything unclear — and confirm the Definition of Ready holds. Do not write code yet. Wait for my confirmation.

### 3. After it restates correctly — unblock it

> Confirmed, proceed.

If the restatement is wrong, correct it here instead. It is the cheapest moment to fix a misunderstanding.

### 4. Resume a session that ended mid-task

> Check STATUS.md for the task marked `in_progress` and read its Notes. Restate where it stopped and what remains, then continue that task from there. Do not start any other task.

### 5. Rework after your PR review

> Rework task `P1-T01`. Address these review comments: `<paste comments>`. Do not change anything outside the scope of these comments. Update the PR when done and stop.

### 6. Start a phase design gate (once per phase that has one)

Design-gate tasks (`P3-T00`, `P4-T00`, `P5-T00`) write docs to `docs/design/` and need your explicit approval before that phase's build tasks start.

> Execute the design-gate task `P3-T00`. Produce the design docs it names. Do not start any implementation task. When done, stop and wait for my review.

Then, to approve:

> Design approved for Phase 3.

---

## Notes

- Task IDs run `P1-*` (Phase 1, prove the pipeline) through `P8-*` (Phase 8, community launch), in eight sequential phases. Full index in IMPLEMENTATION-PLAN.md appendix.
- Each phase gates on the previous phase being `done`; per-task dependencies still apply (EXECUTION-GUIDE.md §4).
- If Claude is blocked, it sets the task to `blocked` in STATUS.md and asks. Answer the question, then it resumes.
- Full protocol: EXECUTION-GUIDE.md. Agent rules: CLAUDE.md.
