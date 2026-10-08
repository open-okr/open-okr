# Writing OKRs where you read them

How a member reads and writes OKRs in one place: the list and diagram views of the OKRs screen, edited in place, on one client cache. Companion to [adaptable-practice.md](adaptable-practice.md).

| | |
|---|---|
| Asked for | Add and update OKRs inline on the list, and view and update them on a diagram |
| Reference | FlowyLMS, OKRI Membership, "My OKRs" (`flowylms`: `MyOkrController.php`, `public/js/my-okrs-inline-edit.js`, `resources/js/components/okr/OkrDiagram.vue`) |
| Specification it closes | UIUX-PLAN.md §4 already requires inline editing, optimistic updates and undo. S-13 already asks for "a new-goal action" and inline editing. S-16 already asks to "edit the selected node, re-parent it". None of them is built |
| Builds on | [okr-entry-points.md](okr-entry-points.md) §3.1 sidebar and §3.2 OKRs screen. Its gate stance (§2) is superseded by METHOD.md §2.9: anybody can write by default |

---

## 1. The gap today

| What a member wants | What happens today |
|---|---|
| Add an objective from the list of objectives | `/goals` is read-only. Its empty state points at `/cycle?phase=4` |
| Add a key result to an existing objective | Only on the drafting screen. The goal page says "Key results are added in phase 4" |
| Fix a typo in a title, change a target, change an owner | A separate form per field, on a separate screen, or nothing: targets cannot be edited from any list |
| See the OKRs as a tree | `/goals/studio` draws goals only, not key results, and nothing can be edited on it except dependencies |
| See the same change in both places | Two unrelated screens with two reads |

Measured in code by the P9-T00 survey:
- **No inline editing exists anywhere** for objectives or key results. The only edit-in-place pattern is `InlineSelect` for initiatives.
- **TanStack Query is installed and unused.**
- **The goal page's confidence slider is ignored by its server action.**
- **There is no action to delete a key result.**

## 2. What FlowyLMS teaches

FlowyLMS's "My OKRs" is the reference Akmal pointed to. Its strengths are worth copying; its flaws are the ones this design is built to avoid.

| Copy | Avoid |
|---|---|
| Click-to-edit cells whose input has the same box as the text, so nothing shifts. Enter or blur saves, Escape reverts, unchanged values are skipped | List edits that tell no one: the diagram stays stale until a reload |
| A "+ Add key result" row under each objective and a "+ Add objective" row at the end | Adding writes an "Untitled" placeholder to the server before anybody types, and Escape leaves it there |
| A `current / target unit` cluster where each part is editable | Saving the full form deletes and recreates every key result, which wipes check-in history |
| One save shape, one field at a time, and a response carrying the recomputed parent progress | A free-text period instead of a cycle |
| A side drawer shared by both views, deep-linkable, with check-ins and history | Silent diagram errors (`catch(() => {})`) |
| A diagram: dagre lays out cycles and objectives top-down, key results stacked under their objective, and the saved order re-applied after layout | Reordering only the rows a filter shows, so hidden rows collide |
| A "+ KR" button on each objective node; collapse per node and for all; fit to view | No editing on the node itself, and no re-parenting |
| One status colour system across list, diagram and legend; a header line "N active · avg X%" | |

## 3. The OKRs screen

One screen replaces S-13, the goals explorer, and absorbs S-16, the alignment studio, as its diagram view. The sidebar follows Agung's §3.1 regrouping, with "Goals" renamed "OKRs" (decision D5).

```
┌ OKRs ─────────────────────────────────────────────────────────────────────┐
│ Q4 2026 ▾   Mine · My team · Company · All     [ List | Diagram ]  + New objective │
│ 8 objectives · 21 key results · avg 54% · 2 at risk · 1 outdated             │
├────────────────────────────────────────────────────────────────────────────┤
│ ⋮⋮ ▾ ◆ Make mobile the way customers prefer to reach us   Aspirational  PR  ███▌ 54%  On track  7/10 │
│        ○ Raise weekly mobile actives  from 12k → 30k   18k / 30k users  ██ 33%  6/10  Mei   Dec 12 │
│        ○ Cut app crash rate           from 2.1 → 0.5%  1.2 / 0.5 %      ███ 56%  7/10  Mei   Dec 12 │
│        ○ Ship offline mode (milestone)                 not done          0%      8/10  Tomás Nov 30 │
│        + Add key result                                                                     │
│ ⋮⋮ ▸ ◆ Margins we can run the business on again   Committed  DO  ██▌ 41%  At risk  …           │
│ + Add objective                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

| Part | Behaviour |
|---|---|
| Cycle switcher | The current cycle by default; any cycle the reader can see; "No cycle" for goals with their own timeframe |
| Scope tabs | Mine (I am the champion or a key result owner, or I follow it; goals have no contributor list), My team (spaces I belong to), Company (company level), All. The tab is kept in the address |
| View toggle | List or Diagram. Kept in the address (`?view=diagram`), so a link opens the same view; the last choice is remembered per member |
| + New objective | Always shown when the reader can write. It opens an inline row at the top of the list, or a new node in the diagram. If the workspace has restricted writing (§12 of the method), the button opens a panel naming the reason and the link that resolves it, never a dead button |
| Summary line | Counts, average progress, at risk and outdated |
| Filters | Champion, space, health, kind, added mid-cycle. Kept in the address |

**As built at P9-T07a-b.** The cycle switcher is P8-G12's picker, whose links carried no cycle until this task: its template was built on the server from a constant exported by a client component, which reaches the server as a reference rather than a string, so both placeholders now live in a plain module. Mine keeps `mine=1`, which the filter assist has always written; My team and Company are `scope=team` and `scope=company`, and Company is the company level whatever the level chips say. Mine follows the tree's own meaning (champion, reviewer or key result owner); following has no data yet. The view toggle is P8-G12's display group, `display=diagram` rather than `view=diagram`, because `view` already meant the Tree display's ordering. The champion and space filters are selects that navigate; kind and added mid-cycle arrive with P9-T11 and P9-T13. The summary counts caution and off track as at risk. "+ New objective" is P8-G12's button; its restricted-writing panel is P9-T07b's. The list says `aria-busy` while any change is on its way to the server.

## 4. The list view

### 4.1 Rows

| Row | Shows |
|---|---|
| Objective | Grip, collapse, kind chip (Committed or Aspirational), title, champion avatar, progress bar with pace (§3.7 of the method), health, confidence, next check-in, the "added mid-cycle" mark where it applies, actions (open drawer, check in, more) |
| Key result | Kind icon (metric, maintain, milestone, baseline), title, the value cluster `current / target unit` (or done/not done for a milestone), progress, confidence, owner, due date, rule verdict chip |
| Ghost rows | "+ Add key result" under each objective; "+ Add objective" at the end |

Aligned child objectives show indented under their parent when the scope holds both, with a toggle to flatten.

**As built at P9-T07a-a**, as far as the data reaches today: the objective row has its title with the OBJ-1 and OBJ-2 chips while it is typed (the stored flags otherwise), the champion picker, the reviewer, the next check-in, progress and health; the key result row has its title with KR-2 and KR-5 chips, the owner picker and due date under it, the value cluster (current, target and unit, with the baseline under them), progress and confidence as x in 10. The kind chip and icon come with P9-T11 and P9-T12, the added-mid-cycle mark with P9-T13, the pace with P9-T15, the grip with P9-T07b.

### 4.2 Editing in place

Every cell follows UIUX-PLAN §4, "Inline edit".
- **Click** a cell, or press Enter on it, to edit. The input occupies exactly the box the text did.
- **Enter** or blur commits. **Escape** reverts. **Tab** and **Shift+Tab** commit and move to the next or previous editable cell in the row.
- **An unchanged value** sends nothing.

| Cell | Control | Saved through | Policy and checks |
|---|---|---|---|
| Objective title | Text, live OBJ-1 and OBJ-2 verdict chips as you type | `goals.patch {title}` | Verdicts warn beside the cell; a check set to block shows red and still saves the draft text |
| Kind | Chip toggle: committed or aspirational | `goals.setKind` | Recorded in the activity |
| Champion, key result owner | Member picker | `goals.patch {championId}`, `goals.patchKeyResult {ownerId}` | Access to the space is checked server-side |
| Key result title | Text, live KR-2 and KR-5 chips | `goals.patchKeyResult {title}` | As above |
| Current value | Number | `goals.recordValue` | A KPI-linked key result shows its value read-only with a link to the KPI |
| Target | Number | `goals.changeTarget` | Making it harder saves. Easing it, toward the baseline (lowering an increase, raising a reduce), opens a one-line reason field under the cell, when the workspace requires one |
| Baseline, unit, due date | Number, text, date picker | `goals.patchKeyResult` | |
| Milestone done | Checkbox | `goals.patchKeyResult {doneAt}` | |
| Confidence | 0 to 10 stepper, shown as "x in 10" | Recorded with the next check-in, or as a quick confidence update | |

**As built at P9-T11b-a, the kind.** A chip-coloured select rather than a two-state toggle, so the keyboard and a screen reader meet a named control ("Kind of …"). Choosing the other kind opens one line beside it asking why; Enter or Save sends it **with or without an answer**, because METHOD.md §2.8 asks for the change to be visible rather than justified, and Escape keeps the kind it had. The same control sits in the list's row, the drawer's details and the diagram card's header, where the question floats over the card because the layout has fixed its height. **Where the workspace uses one kind there is no chip, no picker and no filter**: every objective is that kind, and saying so on every row is noise. "+ New objective" and the cycle screen's drafting form offer the kind, starting at the workspace's default (D2); the list's add rows take the default and the chip changes it after. A closed objective shows its kind and does not offer a change.

**As built at P9-T12c-a, the key result's kind.** A select in the row's meta line, beside the owner, rather than the icon §4.1 sketched: four words a reader can choose from with the keyboard, where an icon would have been a fifth thing to learn. The value cluster is the kind's question: a metric keeps value, target, unit and "from"; a maintain the same with "Band" for "from"; a milestone a done checkbox and nothing else; a baseline one field, "Record the baseline", empty until a value is recorded and then the value it found. The drawer's details and the diagram card's row follow the same rule, and both check-in composers tick a milestone instead of asking for a number. A key result added from the list is a metric, and its kind changes in the row; a kind the workspace has turned off is not offered, unless the key result already is one.

### 4.3 Adding

- **No placeholder records.** "+ Add key result" inserts a client-side draft row with the cursor in its title.
  - Nothing is written until the first commit with a non-empty title.
  - Escape on an empty draft removes the row.
  - The new key result defaults to a metric owned by the objective's champion and due at the cycle's end, so the first commit needs only a title. Other fields can be filled in the same row with Tab.
  - A metric key result also needs a target before it goes live. Before the cycle's plan is published every row is a draft anyway. After the team publication window, a row saved without its target is a draft its space can see, marked with what is missing, until the target is filled (METHOD v2 §2.9).
- **"+ Add objective"** does the same at the objective level, in the scope and cycle on screen, with the reader as champion and the kind defaulting per the workspace (decision D2). It opens with one empty key result draft row under it.
- **Policy is asked on commit.** If the workspace has restricted writing, the server refuses with the reason. The draft row stays, showing the reason and the link that resolves it, so nothing typed is lost (UIUX-PLAN §1.7, "Never lose work").

**As built at P9-T07b-a.** P8-G12's add rows already held a draft in the page and wrote on Enter; they now keep the typed title with the server's sentence on a refusal, and an objective just added opens one key result draft under it with the caret in it. A new key result is owned by the objective's champion and due on the cycle's last day; it is still a metric from 0 to 100 until P9-T12's kinds, and a key result saved without its target stays a draft only from P9-T13. Where writing is held back, "+ New objective" in the header and the add row at the foot of the list open the restricted-writing panel instead of a field: the policy's own sentences, read ahead of any write through `goals.creationPolicy`, with a link to the cycle where a phase or the window is the reason and to the practice for an administrator. The topbar's `+ New` links to the OKRs screen with "+ New objective" already open, and is not offered to a reader who cannot write.

### 4.4 Moving, deleting, checking in

| Action | How |
|---|---|
| Reorder | Drag by the grip, within the same parent. The keyboard alternative is Alt+↑ and Alt+↓. The whole order is saved, never just the visible rows |
| Delete a key result | More menu, then delete, with the six-second undo toast. A soft delete through `goals.removeKeyResult`, which P8-G12 built, restorable from deleted items (P9-T06b). One removal rather than a second action beside it |
| Stop an objective | More menu, then stop, with a one-line reason. It closes as abandoned (§2.9 of the method). **As built at P9-T13-c-a**, the row has no more menu, so Stop sits with its open, check-in and delete controls, revealed on hover and reachable by keyboard, and asks the reason in place |
| Check in | The row's check-in action opens the drawer on its check-in tab |

**As built at P9-T07b-b.** Reordering is `goals.place` and `goals.placeKeyResult`: one row put after another, or first, and the whole set renumbered on the server in one statement, which is how a row a filter hides keeps its place: the screen names only the new neighbour, never the order it can see. Alt and an arrow anywhere in a row move it, and the keyboard goes back to the row's grip after each move so the next press needs no hunting; the grip also drags onto another row of the same set, landing above or below it by which half it is dropped on. Deleting an objective joined the cache: the row goes at once and the toast offers Undo for six seconds, which restores it through `goals.restore`. **Stopping moved to P9-T13**, which builds the stop as a close-abandoned with a reason; the list's control comes with it.

**As built at P9-T08b.** The objective row's check-in action opens the drawer on its check-in tab, for somebody who may change the objective while it is open. The row's open control stays a link to the goal page (P9-T08a), and only a plain click opens the drawer.

### 4.5 States

| State | Treatment |
|---|---|
| Loading | Skeleton rows at the final layout |
| Empty cycle | One sentence and the "+ Add objective" row. The phase checklist link only where phases are guided or binding |
| Empty filter | "Nothing matches" with a clear-filters action |
| Error | The row keeps the typed value, shows the server's sentence beneath it, and offers retry. **As built at P9-T07a-a:** the cell goes back to the stored value, and a line under the row reads "Not saved:" with the server's sentence, Retry (which sends the typed value again, as it was) and Discard. The typed value lives in that retry rather than in the cell, because a cell holding a value the server refused would read as saved |
| Read-only reader | No pencils, no ghost rows, no grips. Values are plain text. **As built at P9-T07a-a:** every cell renders as text rather than a disabled control, and the champion picker is text for anybody below `full`, which naming a champion asks |
| Stale write | The server refuses with the current value; the cell shows "Changed by Mei a moment ago" with the two values and keep-mine or take-theirs |

## 5. The diagram view

### 5.1 The library

**React Flow (`@xyflow/react`, MIT) with `@dagrejs/dagre` (MIT) for layout.** That is the same pairing FlowyLMS shipped with Vue Flow, so the layout code is proven.

The two are new runtime dependencies, so this needs Akmal's approval (decision D1 in the companion document). Both are bundled at build time, so the air-gapped install is unaffected. The alternative is extending the hand-built `/goals/studio` canvas, which has pan, zoom and keyboard traversal but no drag-to-connect, minimap or node editing; about three tasks of work to reach the same place.

**As built at P9-T09a: React Flow, and no dagre.** Alignment gives every objective one parent, so the picture is a forest: the cycle, and every parent from another cycle as a root of its own. A tidy tree laid out depth first in the list's own order puts siblings exactly where the list does and cannot cross an edge. dagre reorders siblings to reduce crossings, and its order would then have to be undone, which is the §5.2 "Order" step. So the layout is `apps/web/app/goals/okr-layout.ts`, a pure function with its own tests. dagre was approved and is not installed.

### 5.2 Layout

```
                         ┌───────────────┐
                         │  Q4 2026      │
                         └──────┬────────┘
            ┌───────────────────┼────────────────────┐
   ┌────────┴────────┐ ┌────────┴────────┐  ┌────────┴────────┐
   │◆ Make mobile …  │ │◆ Margins we …   │  │◆ Onboarding …   │   company objectives
   │ Aspirational 54%│ │ Committed  41%  │  │ Aspirational 79%│
   │ + KR   + aligned│ │ + KR  + aligned │  │ + KR  + aligned │
   ├─────────────────┤ ├─────────────────┤  └────────┬────────┘
   │○ Weekly actives │ │○ Operating marg │           │
   │  18k/30k   33%  │ │  9/15 %   61%   │  ┌────────┴────────┐
   │○ Crash rate     │ │○ Tickets/acct   │  │◆ Guided setup … │   aligned team objective
   │  1.2/0.5   56%  │ │  2.9/2.0  36%   │  │ Aspirational 90%│
   └─────────────────┘ └─────────────────┘  └─────────────────┘
```

- **Top-down.** The cycle at the root, then company objectives, then the objectives aligned beneath them by `parentGoalId` or `parentKeyResultId`. An objective aligned to a key result hangs from that key result's row, which today's studio cannot draw.
- **Parents in another cycle.** A quarter's objectives usually align to annual ones. Every parent from another cycle is drawn above the cycle's objectives as a context band. The band is read-only on the canvas, opens in the drawer, and is a valid drop target for re-parenting. `goals.tree` returns these parents with the tree (§6).
- **Alignment across levels.** A goal may align to a goal at its own level or above, in any space (METHOD v2 §5.1), so an edge may run sideways between two departments as well as upwards.
- **Placement.** Dagre places the cycle and objective levels. Key results stack under their objective as part of its card, not as separate nodes, which keeps large trees compact.
- **Order.** After layout, siblings are re-sorted to the saved order, so the list and the diagram agree.
- **Edges.** Alignment edges are solid. Dependencies are dashed and can be switched off.
- **Collapse.** Objectives collapse one at a time, or all at once. Beyond the node budget (§7) the tree opens collapsed below company level.

**As built at P9-T09a.** Cards are one width, and a row is as tall as its tallest card. A collapsed card folds its key results and says how many objectives it hides ("+9 below"). Dependencies are dashed and off until asked for. A parent from another cycle is a read-only card in the top row, and its title opens it in its own cycle with the drawer, because this cycle's cache does not hold it. A card opens the drawer; editing on the card is P9-T10's. The filters narrow the diagram as they narrow the list, and an objective whose parent a filter hides hangs from the cycle. Every line is named in words ("X aligns to Y"), and React Flow's own texts (its controls, minimap and keyboard description) are given in the reader's language, the last one saying what the arrow keys do here, which is follow lines rather than move cards. The studio's panel moves in at P9-T09b.

**As built at P9-T09b.** The studio is the diagram. Its health and review tabs are a panel beside the canvas, a finding's objective opening in the drawer when this cycle holds it and in its own cycle otherwise; its link mode is on the toolbar (press one objective, then the one it depends on; Escape stops), saving at once and switching the dependencies on so the new line is seen; and its details tab is the drawer, whose alignment tab now removes a dependency too, which the studio's details panel used to answer (completeness review M-35). `/goals/studio` redirects to the diagram, keeping the cycle, and the cycle gates, the goal page's rail and the Work Map link straight to the diagram. The goals section's one remaining tab went with it.

### 5.3 Editing on the diagram

| Action | How | Saved through |
|---|---|---|
| Edit a title | Double-click the title, or Enter on a focused node; same commit and cancel keys as the list | `goals.patch`, `goals.patchKeyResult` |
| Edit a key result value or target | Click the value in the card | `goals.recordValue`, `goals.changeTarget` |
| Add a key result | "+ KR" on the node: a draft row inside the card | `goals.addKeyResult` |
| Add an aligned objective | "+ aligned" on the node: a draft child node under it | `goals.create` with the parent set |
| Re-parent | Drag from a node's handle onto another objective or key result. The edge shows a preview, the drop asks the policy, and a six-second undo follows | `goals.patch {parentGoalId \| parentKeyResultId}` |
| Add a dependency | Link mode, as today's studio: click one node then another | `goals.addDependency` |
| Reorder siblings | Drag a node sideways within its parent | the shared reorder |
| Everything else | Click the node to open the shared drawer | |

The studio's right-hand panel survives as a side panel of the diagram: alignment health with its gaps, and the coach's semantic findings with apply or dismiss.

**As built at P9-T10a.** A card's title is edited with Enter on the focused card or with the small pencil beside it, rather than a double-click, which is two presses that each open the drawer; Space opens the drawer. A key result's value and target are typed into its row, and an eased target asks why in that same row. "+ KR" and "+ aligned" sit at the foot of an open card and draft in place, writing nothing before Enter; a new aligned objective takes the level below its parent where the cycle uses one, else its parent's own. The live verdict chips are the list's and the drawer's, not the card's, which has no room for them. Every card reads one memoised context rather than copies in its node data, and a folded card carries no add buttons: the footer on thirty folded cards cost about 150 ms on arrival, measured, and leaving it off kept three hundred objectives level with P9-T09b (947 and 1,035 ms against 923 and 932, run the same way). Re-parenting and sideways reordering are P9-T10b's.

**As built at P9-T10b.** Each card has a small move handle at its top left. Dragged and let go over another card, a key result's row, a card in the annual band or the cycle, it re-parents the objective there; the drop is read from what is under the pointer, so anywhere on a card counts and a key result's row is told apart from its card. The line moves at once from the cache, the write is `goals.update`, which keeps the one-parent rule and refuses a loop, and a toast offers Undo for six seconds; an undo offers no undo of its own. The keyboard's way is "Move under…" at the foot of an open card: a list of every place the card may hang (the cycle, each objective and each key result, never itself or what already hangs below it), saved the moment one is chosen. A card dragged sideways is drawn where the pointer has it and, let go, takes the place its centre is in among its siblings, through the list's own `goals.place`; Alt with the left or right arrow does the same from the keyboard, as Alt with an arrow moves a row in the list. A refusal shows above the canvas with the server's sentence.

### 5.4 Accessibility

- **The list is the diagram's text equivalent.** The toggle is a real tab list, and both views share focus.
- **Keyboard.**
  - Arrow keys move between connected nodes.
  - Enter edits.
  - Space opens the drawer.
  - A visible focus ring is drawn on the node.
  - Every drag has a keyboard equivalent: re-parenting is "Move under…" in the node's menu.
- **Accessible names.** Nodes carry `aria-label`s with title, kind, progress and health.
- **The UIUX-PLAN §9 gates.** These apply, including the axe scan, which picks the screen up automatically.

## 6. One cache for both views

The flaw FlowyLMS has, two views drifting apart, is avoided by having one source of truth on the client.

| Piece | Design |
|---|---|
| Read | `goals.tree(cycleId, scope)` returns objectives, key results, alignment and dependencies in one call, shaped for both views, with every parent from another cycle as read-only context. **As built at P9-T06a:** a parent the scope left out of this cycle is context too, marked `otherCycle: false`; a parent the reader cannot see is left out, and the child still names it. "Mine" is what the reader champions, reviews or owns a key result under; following an objective has no data yet, so it is not part of the scope |
| Cache | TanStack Query, already in the locked stack and installed. The key is `["okr-tree", cycleId, scope]`; both views read the same entry. **As built at P9-T06c:** read through a server action (`lib/okr-tree/actions.ts`), seeded by the server's own render so the first paint costs no second request, and kept in memory only: the provider persists every other query to local storage, and a workspace's plans with names in them should not outlive a sign-out on a shared machine. P8-G12's table is the first reader; the diagram still draws the server's render of the same tree until P9-T09 moves it onto the cache |
| Write | Every mutation goes through one `useOkrMutation` hook: patch the cache at once, call the server action, on refusal roll back and show the server's sentence, on success merge the server's recomputed progress, health and verdicts. **As built at P9-T06c:** the server action takes six writes by name and no others (patch, patch a key result, a value, a target, remove and restore a key result); a write that returns no node, a value or a removal, re-reads the tree instead; a conflict rolls back and offers keep-mine, which sends the change again made from the stored values, or take-theirs, which re-reads. Adding a row and deleting an objective still re-render the page, because the header's count and the alignment score are the server's |
| Undo | Deletes, stops, re-parents and reorders push an undo entry for six seconds (UIUX-PLAN §4) |
| Concurrency | Every `goals.patch*` carries the token from the read; a stale write is refused with the current value (§4.5). **As built at P9-T06a, the token is the values read**: each patch sends `read` beside `set`, field by field, and is refused as a `conflict` (409) with `details.current`, `changedBy` and `changedAt` when a field it changes has moved. A revision column would need every write path to bump it, and `updated_at` moves with every roll-up, so a title edit would fail over a value somebody recorded. Comparing values conflicts only on the fields that moved |
| Live updates | The existing realtime port invalidates the tree key when another member changes the same cycle. **As built at P9-T06c:** the workspace feed's stream does it, coalesced over 1.5 seconds as `FeedLive` coalesces it, because there is no channel per cycle. That stream deliberately never pings a member about their own write, so another tab of the same browser is told over a `BroadcastChannel` instead |
| Drawer | Reads and writes through the same cache, so a change in the drawer shows in the row and the node the moment it saves. **As built at P9-T08a:** a Base UI dialog that is not modal, beside the list rather than over it, so the list stays usable. It lives in the address as `okr`, `tab` (details, history, alignment) and `kr`, changed through the history API so opening it renders nothing again on the server; a link naming an objective in another cycle opens that cycle. The cells are the list's own, and what each sends is written once in `okr-editing.ts` for both. History and Alignment come from one server action over four reads the registry already had (`goals.checkIns`, `goals.keyResultHistory`, `goals.targetHistory`, `goals.relations`), kept in memory under `["okr-detail", goalId, keyResultIds]` and read again after every write. Escape in a field puts the field back; Escape anywhere else closes the drawer. Kind waits for P9-T11 and re-parenting for P9-T10. **The check-in tab came at P9-T08b**: the composer's own fields held in the drawer until Publish, sent through `goals.publishDraftedCheckIn` so nothing is written before then, with only the values and confidences that moved; the status starts at the last check-in's, because health follows the latest status (METHOD §3.5), and with no check-in yet the reader chooses |

## 7. Performance

| Budget | Target | How |
|---|---|---|
| First paint of the list, 200 objectives with their key results | Within the TECHNICAL-PLAN §13.1 list budget | One `goals.tree` query, TanStack Virtual for the rows |
| Inline commit to visible change | Immediate (optimistic); server confirmation within the §13.1 write budget | The cache patch happens before the request |
| Diagram, 300 objectives | Interactive in under a second on the reference machine | React Flow renders only visible nodes; the tree opens collapsed below company level past 150 objectives |

P9-T09a measures the diagram on the `pnpm db:seed:large` dataset and records the numbers, as P7-T01b did for the other screens.

**Measured at P9-T09a.** Three hundred objectives in one cycle (thirty company objectives with nine aligned below each) opened collapsed below company level and answered a press **891 ms** after navigation, on the development machine against the standalone production build. `e2e/s13e-okr-diagram.spec.ts` repeats it on every run and prints the number, with a 15-second ceiling for whatever machine runs it. It was measured with the end-to-end dataset rather than `pnpm db:seed:large`: what this budget covers is the browser's work, laying out and drawing one cycle, and the server's read of a cycle's tree is TECHNICAL-PLAN §13.1's own row for the OKR tree, which `pnpm perf:budgets` measures on the large dataset. Only the cards on screen are drawn, which is what keeps a wide tree quick.

## 8. UIUX-PLAN and mockup changes, made with the tasks

| Where | Change | Task |
|---|---|---|
| §3 shell | Sidebar regrouped per Agung's §3.1; "Goals" renamed "OKRs"; `+ New` in the topbar opens "+ New objective" | P9-T07a, P9-T07b |
| S-13 | Rewritten as the OKRs screen, list view (§3 and §4 here) | P9-T07a |
| S-14 goal detail | "+ Add key result" row; targets editable with the reason rule; the confidence control actually saved | P9-T08 |
| S-16 | Becomes the OKRs screen's diagram view (§5) | P9-T09b, P9-T10 |
| S-36 | A practice card group: profile and settings | P9-T05 |
| Mockups 12 and 12b | Redrawn: no closed state by default; the restricted state shown only as the governed profile's | P9-T07b |
| Mockup 05 | Redrawn as the diagram view with key result stacks | P9-T09b |

## 9. Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| U1 | A member on the OKRs list with edit access | They click "+ Add key result" under an objective, type a title and press Enter | The key result appears at once and is saved; reloading shows it; nothing was written before Enter |
| U2 | A draft key result row with nothing typed | They press Escape | The row disappears and no record exists |
| U3 | A key result target of 100 | The owner edits it to 80 in the list | A reason field opens under the cell; saving without one is refused with the sentence; with a reason it saves and the history shows both values |
| U4 | The list and the diagram open in two tabs of the same browser | A title is changed in the list | The diagram shows the new title without a reload |
| U5 | The diagram view | A member drags a team objective's handle onto a different company objective | The edge moves at once, the change saves, and an undo toast offers to put it back |
| U6 | Two members editing the same title | The second commits after the first | The second sees "Changed by … a moment ago" with both values, and nothing is silently overwritten |
| U7 | A reader without edit access | They open either view | No editing affordance appears; every value is readable |
| U8 | A workspace on the governed profile, outside its planning window | A member clicks "+ New objective" | A panel names the reason and links to what resolves it; the button is never inert |
| U9 | Keyboard only | A member adds an objective, two key results and re-parents it in the diagram | Every step is reachable without a pointer |
| U10 | 300 objectives in one cycle | The diagram opens | It is interactive within the §7 budget and opens collapsed below company level |
