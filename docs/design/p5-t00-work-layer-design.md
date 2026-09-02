# P5-T00: the work layer

Part three of the Phase 5 design gate. Authority: TECHNICAL-PLAN.md §4.9,
METHOD.md §5.5, UIUX-PLAN.md screens S-26 to S-29, S-32 and S-01. Implemented
at P5-T10a and P5-T10b (initiatives), P5-T11 (tasks and the board), P5-T12
(documents and attachments), P5-T13 (search, palette and exports).

## 0. What already exists

| Component | Package | Ships at | What it holds |
|---|---|---|---|
| `goals`, `key_results` | `packages/db` | P3-T04 | The objectives and the measures. `key_results.capacity` already carries §5.5's verdict |
| Capacity verdicts per key result | `packages/core` | P3-T04 | `fits` / `tight` / `exceeds`, and gate five reads them |
| `blobs`, prepare-upload-claim | `packages/db`, `packages/core` | P2-T11 | Bytes behind the storage port, with orphan cleanup |
| `comments`, `reactions`, `subscriptions` | `packages/db` | P2-T12 | On every major subject already |
| `embeddings` and retrieval | `packages/core` | P4-T13a, b | Access-filtered hybrid retrieval, degrading to full text |
| Soft delete as the default scope | `packages/db` | P1-T04 | `activeOnly` everywhere, with a lint that catches an unscoped write |

**What does not exist.** No `initiatives`, `initiative_key_results`, `tasks`,
`task_assignees`, `checklist_items`, `documents`, `attachments` or
`search_documents` table. The Work Map draws goals and KPIs and nothing below
them.

## 1. The decision this document exists to make

METHOD.md is about objectives, key results and the rhythm around them. Tasks
are not in it. So the work layer has one question at its centre, and every
other decision here follows from the answer:

**Does completing linked work move a key result?**

TECHNICAL-PLAN §4.9's last paragraph answers it, and this design takes that
answer literally:

> Key result progress from linked work: the ratio of completed to total linked
> tasks is shown as a separate signal beside the measured progress. It never
> silently replaces the measured value. A key result whose linked work is
> complete but whose number has not moved is exactly the divergence the coach
> reports.

**No.** Linked work is a second signal, never the first. A key result's
progress comes from its measured value and from nothing else, and the ratio of
finished tasks sits beside it as a different fact about the same thing.

That is not a technical preference. It is the whole reason the product exists:
a team that measures activity instead of outcomes has an OKR practice in name
only, and a product that let a full board turn a key result green would be
teaching exactly that.

**Given** a key result whose linked tasks are all complete and whose measured
value has not moved,
**when** the Coach's divergence check runs,
**then** it reports precisely that, naming both figures, and the key result's
progress is still the measured one.

## 2. Initiatives (P5-T10a for the data and the gate, P5-T10b for the screens)

### 2.1 Tables

| Table | Key columns | Notes |
|---|---|---|
| `initiatives` | `space_id`, `title`, `description` (rich), `owner_id`, `starts_on?`, `ends_on?`, `status` (`planned` / `active` / `done` / `dropped`), `confidence numeric?`, `capacity?` (`fits` / `tight` / `exceeds`), `progress_pct`, `position` | Importable, so `legacy_type` and `legacy_id` with the usual unique index |
| `initiative_key_results` | `initiative_id`, `key_result_id` | Many to many. Unique on the pair |

`progress_pct` is derived from the initiative's own tasks, not from the key
results it serves. An initiative is a piece of work and its progress is how much
of that work is done; that is a different question from whether the measure
moved.

**Three things this table settled at P5-T10a, written down because they are not
obvious from the row above.**

`capacity` is nullable, and null is not `fits`. Null means nobody has judged the
initiative, which is exactly the state §5.5 exists to end, and gate five must not
read the two alike.

There is no `cycle_id`. An initiative reaches a cycle through the key results it
serves, which is the only relationship §5.5 describes. A column would be a second
answer, and the two would disagree the first time one initiative served key
results in two cycles at once.

An initiative owns an access context rather than inheriting its space's:
`workspace_standard` at view because alignment reads across spaces,
`space_standard` at edit, and the owner's own group at `full`. Inheriting would
make the owner binding impossible to express without handing them the whole
space, and it gives §3.3's assignment somewhere to bind. The binding is untagged,
because the tag column carries a fixed set of five role names and `owner_id`
already names the owner. It inherits the goal's open question with the shape: a
delete needs `full` at the workspace and `full` on the initiative, so an
initiative whose owner is suspended has nobody left who can remove it.

### 2.2 Capacity, and the one place initiatives reach into the method

§5.5's capacity check already exists per key result and gate five already reads
it. Initiatives add the other half: an initiative marked `exceeds` makes gate
five red and links to it.

**The gate reads both and mentions whichever is red.** A cycle can fail gate
five because a key result has no capacity behind it, or because an initiative
is over-committed, and the two are different problems with different fixes.

**Given** an initiative linked to two key results and marked as exceeding
capacity,
**when** the cycle's gates are evaluated,
**then** gate five is red and links to that initiative by name.

## 3. Tasks and the board (P5-T11)

### 3.1 Tables

| Table | Key columns | Notes |
|---|---|---|
| `tasks` | `space_id`, `initiative_id?`, `key_result_id?`, `title`, `description` (rich), `status` (`backlog` / `todo` / `in_progress` / `done`), `due_on?`, `position`, `ordering_state jsonb` | Importable |
| `task_assignees` | `task_id`, `member_id` | Multiple. Unique on the pair |
| `checklist_items` | `task_id`, `title`, `done`, `position` | |

**No board table.** A board is a view over `tasks` grouped by status, for a
space, an initiative or a key result. Three boards over one set of rows, which
is why moving a task between boards is not a thing that can happen: it never
belonged to a board.

### 3.2 Ordering, and the problem it actually solves

Two people drag two cards at the same time. Naive integer positions lose one of
the moves or duplicate a slot.

| Decision | Why |
|---|---|
| `position` is a sparse integer, and `ordering_state` holds the ordering metadata | Sparse leaves room to insert without renumbering the column |
| A move is written under a row lock on the column's own set | Two moves serialise instead of interleaving |
| Normalisation runs when the gaps close, in the same transaction | Never as a background job, because a board that renumbers itself while somebody drags is worse than a slow drag |
| Deleted and completed items are excluded from the normalisation | Otherwise a board's order drifts as things are finished |

**Given** two members reordering the same column at the same moment,
**when** both writes land,
**then** the column converges on one order with no card lost and none
duplicated, and both browsers show the same thing after their next read.

### 3.3 Assignment grants access

§4.9 says assignment grants edit access through the member's group. That is a
real access change, so it goes through the Operation pipeline like any other:
the assignment, the binding, the activity row, the audit row and the outbox row
commit together.

Assignment notifies everyone assigned **except the actor**, which is the same
rule the rest of the notification layer already applies.

### 3.4 The rail, and where the second signal appears

Screens S-27 and S-28 put an objective and key result rail beside the board.
The rail shows, per key result:

| Shown | Source |
|---|---|
| Progress | The measured value. The one that counts |
| Linked work | Completed linked tasks over total linked tasks |
| Divergence | Present when the second is complete and the first has not moved |

Two numbers, labelled differently, never added together.

## 4. Documents and attachments (P5-T12)

### 4.1 Tables

| Table | Key columns | Notes |
|---|---|---|
| `documents` | `subject_type` (`space` / `goal` / `key_result` / `initiative` / `cycle` / `session`), `subject_id`, `title`, `body` (rich), `state` (`draft` / `published`), `published_at?`, `author_member_id` | |
| `attachments` | `subject_type`, `subject_id`, `blob_id`, `position` | Any subject, using P2-T11's blobs |

### 4.2 Draft privacy is a query, not a filter

**A draft is visible to its author and to nobody else, and that is enforced in
the query rather than in the component.** The read adds
`(state = 'published' or author_member_id = $me)` to its own where clause, so
there is no code path that returns a draft to somebody else, including a direct
identifier probe. That answers not-found, the same as everything else the
reader may not see.

Publishing emits the activity and the notification. Drafting emits neither: a
draft nobody can read should not appear in anybody's feed.

**Given** a document drafted on a goal,
**when** another space member requests it by its identifier,
**then** they receive not-found, and after it is published they see it with a
readable history of the changes.

### 4.3 Version history

Every publish writes a version row. The difference is computed from the stored
editor JSON through the one shared rich-text module, so the visual difference,
the excerpt, the plain text for search and the email rendering all come from
the same parser.

## 5. Search, palette and exports (P5-T13)

### 5.1 One search table, driven by the outbox

| Column | Notes |
|---|---|
| `subject_type`, `subject_id` | What it indexes |
| `title`, `body` | Plain text, extracted through the shared module |
| `tsv` | The generated full-text vector |
| `context_id` | The access context, for filtering |

Written by an outbox-driven worker, exactly as `embeddings` already is
(P4-T13a). Two indexes over the same content with the same trigger, and that
symmetry is deliberate: they are updated by the same write, so they cannot
disagree about what exists.

**Semantic results are blended when pgvector is available and absent when it is
not**, which is P4-T13b's existing degradation rather than a new one.

### 5.2 Access filtering

`context_id` is on the row, so the query filters in SQL rather than fetching
and discarding. That is the faster shape, and P4-T13b's own note records it as
the known better answer for retrieval too: **if search proves it out, retrieval
should adopt it.**

The difference from retrieval matters. Retrieval asks the access getter per
candidate because it started without a context column; search is being built
now and can have one from the first migration.

**Given** a term inside a private space's document,
**when** a non-member searches for it,
**then** they get nothing, and a member gets a highlighted result.

### 5.3 The palette

Screen S-32. Entity jump by short identifier, actions from the registry, and
recents. The actions it offers are the same registry entries the chat commands
and the tools project, filtered by the reader's own access.

**Given** any screen,
**when** the palette is opened and a short identifier typed,
**then** the entity opens inside the budget.

### 5.4 Exports

CSV and XLSX of any list, matching the visible rows and columns exactly. Large
sets run asynchronously through the outbox, and every export is audited: an
export is the one action that takes data out of the product, so who exported
what and when is a question an administrator will eventually need answered.

## 6. What this layer must not do

Written down because each one is a tempting shortcut that would cost the
product its point:

| Temptation | Why not |
|---|---|
| Roll task completion into key result progress | §1. The whole reason the product exists |
| Let a board have its own ordering table | Three boards over one row set become three sources of truth about one order |
| Show a draft in a feed | A feed entry for something the reader cannot open is a leak with extra steps |
| Skip the outbox for search indexing | Then search and embeddings disagree about what exists, and neither is wrong |
| Grant edit access implicitly on assignment without the pipeline | An access change with no audit row is the one thing the pipeline exists to prevent |

## 7. Open questions for the human

| # | Question | My position |
|---|---|---|
| W1 | Can a task belong to a key result without an initiative? | Yes. Both links are optional and independent. Forcing an initiative would make people invent one |
| W2 | Does an initiative's `progress_pct` come from its tasks or is it typed? | Derived from its tasks. A typed number beside a task list is a number that goes stale in a week |
| W3 | Do documents get their own review inbox obligation? | No. A document is not an obligation; a comment or a mention on one already notifies |
| W4 | Does search index soft-deleted rows? | No. The worker removes the row on delete, so a search result can never outlive what it points at |
| W5 | Should `context_id` on `search_documents` be backported to `embeddings`? | Yes, once search proves the shape, as its own row rather than inside P5-T13 |
