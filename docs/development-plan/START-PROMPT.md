# START-PROMPT.md

The one prompt that starts every development session. Copy the block below, optionally replace the task line, paste it into Claude Code at the repository root. It works in every state: fresh start, mid-task, after a merge, at a design gate, or at a phase boundary. The granular per-situation prompts remain in [PROMPT.md](PROMPT.md); this one figures out which situation you are in.

---

## The prompt

```text
Start an OpenOKR development session.

1. Read docs/development-plan/STATUS.md.

2. Work out the state of play, in this order:
   a. If a task is `in_progress`, or `in_review` with rework requested, that task is
      this session. Read its notes and restate where it stopped and what remains.
   b. Otherwise the session is the task named at the bottom of this prompt.
   c. If no task is named, propose the next `todo` task whose dependencies are all
      `done`, following phase order, and say why it is next.

3. Restate the task from docs/development-plan/IMPLEMENTATION-PLAN.md in your own
   words: goal, deliverables, test plan, dependencies, and anything unclear,
   ambiguous or contradictory across the documents. Confirm the Definition of
   Ready holds, item by item.

4. Special cases, before anything else:
   - If the task is a design gate (P3-T00, P4-T00, P5-T00, P8-T01): say so. The
     session produces design documents only, and implementation in that phase
     waits for my explicit "design approved for phase N".
   - If the task is the first of a new phase: run the previous phase's exit
     checklist from IMPLEMENTATION-PLAN.md first and report each item as met,
     partially met or not met, with evidence. Do not start the task until I
     confirm the phase is closed.
   - If the task cites a reference mockup: look at it before restating.

5. Do not write code, change any file, or update STATUS.md yet. Wait for my
   reply "confirmed, proceed". If anything you found in step 3 needs a human
   decision, ask it now instead of assuming.

Task: <task id, for example P1-T01, or leave this line out to get a proposal>
```

---

## The replies you will use

| Situation | You reply |
|---|---|
| The restatement is right | `confirmed, proceed` |
| The restatement is wrong | Correct it in plain words. This is the cheapest moment to fix a misunderstanding |
| A design gate's output is right | `design approved for phase N` |
| The change needs rework after review | The rework prompt in [PROMPT.md](PROMPT.md) §5, with the review comments pasted in |

## What the agent does after "confirmed, proceed"

Tests first, then implementation until green, then the quality checks, then one change request titled `<TASK-ID>: <title>` on branch `task/<task-id>-<slug>`, with STATUS.md set to `in_review`. Then it stops. It never merges its own work and never starts the next task on its own. The full protocol is [EXECUTION-GUIDE.md](EXECUTION-GUIDE.md); the agent's hard rules are [CLAUDE.md](../../CLAUDE.md) at the repository root, loaded automatically.
