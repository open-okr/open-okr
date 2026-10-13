# Ids inside JSON across a workspace move

Status: proposed, 13 October 2026. Waiting for "design approved".

A workspace archive moves a workspace to another instance (TECHNICAL-PLAN §7.3). Every row gets a new id, and the import rewrites references to them. It rewrites a column that holds an id, and the mentions and attachments inside rich text (`RICH_TEXT_COLUMNS`). It does not rewrite an id anywhere else inside a `jsonb` value. This document is about those, starting with the review queue.

## 1. What is wrong today

| Where | What happens on a move | Found by |
|---|---|---|
| An agent's proposal (`proposed_changes` with a `run_id`) | **Skipped, silently.** `agent_runs` is left out of the archive, so the run the proposal names does not exist in the target. The table's `proposed_changes_origin` check requires exactly one of `run_id` and `thread_id`, so the import cannot empty it either. The insert fails and the row counts as skipped. The archive policy says "The proposals it produced are carried", which is not true | Reading the policy and the constraint, 13 October 2026 |
| A copilot proposal (with a `thread_id`) | Carried, but its `payload`, which is the input of the action it proposes, keeps the source workspace's ids: the goal, the key result, the member, a mention. Applying it then refuses as not found, or reads as about nothing | The archive import fixes in 0.4 |
| A decided proposal's `result` | The same, for history | Same |
| Other `jsonb` values that name rows: `activities.payload` (an initiative's `keyResultId`, for one), `check_in_snapshots.entries` (each names its key result) and `ai_messages.citations` (each an `entityId`) | The same. A moved check-in's history no longer finds its key results | Listing every exported `jsonb` column |

## 2. The design

### 2.1 One rule for ids inside JSON

**Every string inside a `jsonb` value that is a uuid the key map holds is replaced by its new id.** Objects, arrays and nesting are walked. Every other string, number and key is copied as it is.

| Question | Answer |
|---|---|
| Can it change something that is not a reference? | No. The key map holds the ids of the rows this archive carries, and a uuid that equals one of them is that row. Two random uuids do not collide |
| What about an id the archive does not carry, such as an excluded table's? | Not in the key map, so it is left as it is, exactly as today |
| A member merged by email? | The key map already maps the archived member to the existing one, so the reference follows the merge |
| Rich text? | Covered by the same rule: a mention's `attrs.id` and an attachment's `attrs.blobId` are uuids in the key map. `RICH_TEXT_COLUMNS`, its map variant and their guard test stay, and keep passing, so nothing regresses. Retiring them is a later tidy-up |
| Cost? | One walk of each `jsonb` value, already in memory |

### 2.2 An agent's proposal

The run that made it does not travel. Two ways to carry the proposal anyway, and one to stop pretending:

| Option | What it does | Cost |
|---|---|---|
| **A. Report, do not carry (recommended)** | The import leaves agent proposals out on purpose and says so: the difference report gains `proposalsLeftBehind`, with the count, and the admin preview says "N agent proposals stay behind: the Coach and the Champion propose again on their next run". The policy's reason is corrected | Nothing a person relies on is lost. Both agents are deterministic first, so a proposal still true of the moved data comes back on the next run, against the new ids. A decided proposal's history stays on the source instance, and the change it made is already in the data and in the activity feed |
| B. Carry with an imported origin | A migration relaxes the origin check to allow a third origin, `imported`, with neither run nor thread. The import empties `run_id`, sets the origin and keeps which agent proposed it. The queue shows "Proposed by the Champion before this workspace moved" | A migration and a check-constraint change, a new origin every reader of `proposed_changes` must handle, and pending proposals that may no longer be true of the moved data |
| C. Carry the runs | Export `agent_runs` too | Runs record cost and provider state against the source instance's provider, which is why they were left out |

### 2.3 What the import reports

The difference report and the archive preview already say what is created, merged, skipped and left out (13a's `leftOut`). They gain:

- `proposalsLeftBehind`, under option A.
- Nothing for the id rewrite. It is not a choice a person makes, and it changes no row count.

## 3. Acceptance

- **Given** a copilot proposal to change a goal's title, **when** the workspace moves, **then** the proposal names the goal's new id and applying it changes that goal.
- **Given** a check-in with a snapshot, **when** the workspace moves, **then** every entry's `keyResultId` is the key result's new id.
- **Given** an activity whose payload names a goal, **when** the workspace moves, **then** the payload names the goal's new id.
- **Given** a `jsonb` value holding a uuid the archive does not carry, **when** the workspace moves, **then** that uuid is unchanged.
- **Given** two pending agent proposals (option A), **when** the workspace moves, **then** neither row is written, the difference report's `proposalsLeftBehind` is 2, the preview says so, and nothing counts them as skipped.
- **Given** any exported table with a `jsonb` column, **when** the guard test runs, **then** it moves a row that holds a key-mapped uuid in that column and checks it was rewritten. A new `jsonb` column fails until the test moves one.

## 4. Decisions for a person

1. Option A, B or C for agent proposals. Recommended: A.
2. Whether the generic rule (2.1) should cover every exported `jsonb` column, as proposed, or only `proposed_changes`. Recommended: every column, because the snapshot and activity cases are the same defect.

## 5. Split

One change if A is chosen: the generic rewrite, the proposals left behind with their report and preview line, the policy's reason corrected, and the guard test. B adds a migration and would be a second change.
