# PROMPT.md

Copy-and-paste prompts for running OpenOKR development with Claude Code. Day to day you only name a task identifier. The agent pulls in everything else itself.

To start a session, use the single prompt in [START-PROMPT.md](START-PROMPT.md). It detects the state you are in and covers prompts 2, 4 and 6 below. The prompts here remain for the other situations.

---

## How the agent finds the plan

`CLAUDE.md` at the repository root is loaded automatically. It names the whole document set, the authority order, the hard rules and the task loop. You never paste the document list.

| For | The agent reads |
|---|---|
| Every session, automatically | `CLAUDE.md` |
| What to do next | `STATUS.md`, for the next `todo` whose dependencies are `done` |
| What a task means | `IMPLEMENTATION-PLAN.md` |
| What good OKR practice is | `METHOD.md` |
| Interface specification | `UIUX-PLAN.md`, screens S-xx and the interaction patterns |
| Schema and engines | `TECHNICAL-PLAN.md` §4, §6, plus the importer mapping in §7.2 |
| AI, agents and channels | `AI-NATIVE-PLAN.md` |
| Importer source facts | `reference/` |

## Two rules that keep it safe

1. **You pick the task, one at a time.** The agent never starts the next one on its own. After a merge, set the row to `done` and start the next.
2. **You review and merge everything.** The agent opens the change and stops.

A typical turn: check STATUS.md, paste prompt 2 with the next eligible task identifier, reply "confirmed, proceed", review the change.

---

## The prompts

### 1. Once per repository: bootstrap

> Read CLAUDE.md, then docs/development-plan/REQUIREMENTS.md, PLAN.md, METHOD.md, TECHNICAL-PLAN.md, AI-NATIVE-PLAN.md, UIUX-PLAN.md, IMPLEMENTATION-PLAN.md and EXECUTION-GUIDE.md. Do not write any code. Reply with: (1) a one-paragraph summary of what we are building, (2) the first task identifier you would execute and why, (3) any contradiction or ambiguity you found across the documents. Then stop.

### 2. Start a task, the everyday prompt

> Execute task `P1-T01` from docs/development-plan/IMPLEMENTATION-PLAN.md. First restate the task in your own words: goal, deliverables, test plan, and anything unclear. Confirm the Definition of Ready holds. Do not write code yet. Wait for my confirmation.

### 3. Unblock it

> Confirmed, proceed.

If the restatement is wrong, correct it here instead. This is the cheapest moment to fix a misunderstanding.

### 4. Resume a session that ended mid-task

> Check STATUS.md for the task marked `in_progress` and read its notes. Restate where it stopped and what remains, then continue that task from there. Do not start any other task.

### 5. Rework after review

> Rework task `P1-T01`. Address these review comments: `<paste comments>`. Do not change anything outside the scope of these comments. Update the change when done and stop.

### 6. Run a design gate

Four tasks are design gates: P3-T00, P4-T00, P5-T00 and P8-T01.

> Execute the design-gate task `P3-T00`. Produce the design documents it names. Do not start any implementation task. When done, stop and wait for my review.

Then, to approve:

> Design approved for phase 3.

### 7. Review a spike result

> Summarise the spike's findings against its risk-register row in PLAN.md §12, and recommend proceeding or falling back with the fallback spelled out. Do not proceed until I reply with the decision.

### 8. Check a phase exit

> Run the exit checklist for phase `N` from IMPLEMENTATION-PLAN.md and report each item as met, partially met or not met, with evidence. Do not start the next phase.

### 9. Check method conformance

Use this whenever a rule, threshold, band, corridor, taxonomy or agenda has been touched.

> Compare `packages/method` against METHOD.md and report every difference in rules, thresholds, bands, corridors, taxonomies, gates, session definitions and diagnostics. Do not change anything. Tell me which side is wrong in each case.

---

## Notes

- Task identifiers run from `P1-*` (foundation) to `P8-*` (cloud, enterprise and launch). There are 105 tasks. The full index is in IMPLEMENTATION-PLAN.md appendix A, and the deferred backlog is appendix B.
- Each phase gates on the previous one, and per-task dependencies still apply. Parallel worktrees are allowed for independent tasks.
- If the agent is blocked it sets the task to `blocked` in STATUS.md and asks. Answer, and it resumes.
- The full protocol is in EXECUTION-GUIDE.md. The agent's rules are in CLAUDE.md.
