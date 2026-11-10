# How a run uses an agent's instructions

Status: approved 10 November 2026, every question as proposed, and built in 0.7.0 (plan A7). It adds a new subsystem (the planner) and decides how much an agent may choose, so it was designed first (CLAUDE.md).

Authority: AI-NATIVE-PLAN §6.5 ("staged instructions (planning and execution) that are versioned like prompts"; "The planning phase decomposes the work"), `agents.md` §8 (instructions vary by the cycle's phase), AI-NATIVE-PLAN §6.5's own open item from completeness review M-11: "which registry actions a custom agent's planner may choose from and what it is shown of its bound resources".

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| Two instruction fields | `agents.planning_instructions`, `agents.execution_instructions` | Free text, set by `agents.create`, never edited after, never versioned |
| Nothing reads them | | The Coach and the Champion are deterministic and seeded with fixed text. A custom agent's run starts with its task list already written by whoever called `agents.startRun` |
| Runs | `agents.startRun`, `packages/agents/src/run-executor.ts` | Each step dispatches one registry action as the agent: a read runs, a write becomes a proposal (`propose`, the default), a sandbox commits nothing. A model is required but no step asks it anything |
| Versioned prompts | `ai_prompts` (`workspace_id`, `prompt_key`, `version`, `system_prompt`) | Versions keyed by free text; A9 sends the newest version that passes its evaluation set |

So the instructions have nowhere to go. The place they belong is the planning phase, which was never built: given what the agent is told to do and what it can see, decide the tasks.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| I1 | **Two stages, chosen by the cycle's phase.** Planning instructions apply while the agent's cycle is in phases 0 to 5 (strategy to align and commit); execution instructions in phases 6 and 7 (run the cadence, review and learn). The cycle is the current quarterly cycle of the agent's first bound space, else the workspace's | AI-NATIVE §6.5 names two stages and the table already has two fields. Eight per-phase texts would be eight things nobody keeps current |
| I2 | **Versioned in `ai_prompts`**, under the keys `agent.<agentId>.planning` and `agent.<agentId>.execution`, one row per save, with who saved it. The agent's own column is version 0, so an agent made before 0.7.0 keeps its text and needs no data change | The table already versions text by key, behind its tenant policy. No migration |
| I3 | **The planner**, `agents.planRun`: one model call that turns the stage's instructions, plus what the agent can see (I5), into a task list for the existing run executor. It is structured extraction: the answer must parse as tasks against each action's own input schema, or the run is not started and the agent's log says why | The run machinery, its proposals, sandbox and costs, already exist. The planner only writes the list a person writes by hand today |
| I4 | **What the planner may choose**: the read and write actions in the agent's own toolsets that are on the agent surface. **Never a destructive action.** Writes become proposals in `propose` mode, as every step's do, and a destructive action is not on the menu at all | Least privilege (CLAUDE.md). A model that may propose deleting a goal is a model that one day does. A person can still delete; the agent cannot ask to |
| I5 | **What the planner is shown**: the title, level, state, progress and confidence of each goal and key result, and each KPI's title, state and latest value, in the agent's bound spaces and KPI trees, read through the agent's own access. No comments, no check-in notes, no member other than by name as a champion | Enough to choose a sensible next step; nothing a binding does not already grant; no free text a third party wrote, which is where a prompt injection would hide |
| I6 | **Who starts a planned run**: a person with the agent page's "Plan a run" (admin, as today's run controls), or the agent's own schedule where it has one. `agents.startRun` with a written task list stays for callers who already know the tasks | Planning is opt-in per run; nothing an agent does today changes without someone choosing it |
| I7 | **Gated like a prompt (A9).** The planner's own system prompt gets an evaluation set (fixtures of instructions and visible resources, with the task lists expected, including a refused destructive one). The workspace's instructions are its own words and are not gated, but A9's size and personal-data checks apply on save | The product's prompt is the product's to keep good; an administrator's instructions are theirs |
| I8 | **The Coach and the Champion stay deterministic.** Their instructions are shown read-only on their pages as the canon's emphasis (`agents.md` §8's table) and are not sent anywhere | Their decisions are METHOD.md's, never a model's (CLAUDE.md, deterministic first) |
| I9 | **AI off, or egress closed: no planned runs**, as no custom agent runs today. "Plan a run" is hidden, the instructions stay editable | The same rule the run executor already applies |

## 2. The screen

On a custom agent's page in Admin, Agents: two text areas, "While planning (phases 0 to 5)" and "While running (phases 6 and 7)", each with its version history (version, who, when, Restore), and "Plan a run", which shows the proposed task list before it starts the run. Loading, empty, error and permission-denied states; strings in both catalogues.

## 3. Questions for Akmal

| # | Question | Proposed |
|---|---|---|
| Q1 | Two stages chosen by phase (I1), or one text per phase (eight)? | Two stages |
| Q2 | The planner's menu: the agent's toolsets' reads and writes, never destructive (I4)? | Yes |
| Q3 | What the planner is shown (I5): titles, states and numbers in its bindings, no free text written by people? | Yes |
| Q4 | The Coach and the Champion stay deterministic, their instructions read-only (I8)? | Yes |

## 4. Acceptance criteria

- Given a custom agent bound to one space whose cycle is in phase 4, when a person plans a run, then the planner is sent the planning instructions' newest version and the space's goals by title, state and progress, and nothing else.
- Given the model answers with a task naming `goals.delete`, then that task is refused, the run is not started, and the agent's log says which task and why.
- Given the model answers with two valid writes, when the run starts in `propose` mode, then two proposals reach the review inbox and nothing is written.
- Given a person saves new execution instructions, then version 2 exists with their name, version 1 can be restored, and the next planned run in phase 6 uses version 2.
- Given AI off, then "Plan a run" is not shown and the instructions can still be edited.
- Given the Coach's page, then its instructions are shown read-only and no planned run is offered.

## 5. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/agents/test/planner.test.ts` | Stage choice by phase, the menu (no destructive), the visible-resources payload, a malformed answer refused |
| Evaluation | `packages/agents/src/evaluation` (A9's sets) | The planner's set |
| Integration | `packages/core/test/agent-instructions.test.ts` | Versioning in `ai_prompts`, restore, version 0 from the column, planned runs producing proposals |
| Browser | `e2e/s36q-agent-instructions.spec.ts` | Edit, history and restore; with AI off no "Plan a run" |

## 6. As built

| Piece | Where |
|---|---|
| Stage by phase, versions, the planner's view, menu and checks | `packages/core/src/agents/instructions.ts` |
| `agents.instructions`, `agents.setInstructions`, `agents.restoreInstructions`, `agents.planRun` (all off the agent surface) | `packages/core/src/actions/agent-instructions.ts` |
| The planner's model call, and its evaluation set | `planRun` in `packages/agents/src/drafter.ts`; `packages/agents/src/evaluation/sets.ts` |
| The personal-data check on save | `setPersonalDataFinder`, installed at boot with the adapters' `redactPersonalData` beside A9's evaluator |
| The screen | Each agent's row on Admin, Agents: `apps/web/app/admin/agents/agent-instructions.tsx` |

Where the build is narrower than §1, and why:

- **The menu is the `core` toolset (I4).** Agents carry no toolsets of their own, so the everyday set every agent connection starts from is the menu, without `agents.*` and `proposals.*`. A task's input must parse strictly: a field the action does not take refuses the plan.
- **A plan is previewed, then started (I3, §4).** `agents.planRun` answers the checked tasks or the refusal and starts nothing; "Start this run" calls `agents.startRun` with them. A refused plan is said on the screen rather than written to a run's log, because no run exists yet.
- **No planned run on the agent's own schedule yet (I6).** Planning is by hand for 0.7.0. A scheduled planned run spends model tokens with nobody watching, so it waits for a row of its own.
- **The cycle (I1)** is the workspace's current quarterly cycle; an agent's bound space has no cycle of its own.
