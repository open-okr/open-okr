# Workspace roles with a settable permission matrix

Written 1 October 2026, after Agung asked for objective access to come from
explicit roles whose permissions can be set, rather than from a member's role
in a space, and said the point is that creating and changing OKRs should be
easier.

Authority: REQUIREMENTS.md, then PLAN.md, then METHOD.md, then
TECHNICAL-PLAN.md §4.1, which this document proposes changing.

## 0. What is true today, including the part that was assumed wrong

| Holder | Level on a new objective | Written by |
|---|---|---|
| Champion | full (100) | `bindRole`, tag `champion` |
| Reviewer | edit (70) | `bindRole`, tag `reviewer` |
| Every member of the owning space | edit (70) | `space_standard` binding |
| Every member of the workspace | view (10) | `workspace_standard` binding |

**Space membership does not decide who can see an objective.** Every objective
is already workspace-visible. What a space decides is who may *edit* it. So the
change is one binding, not the access model.

Levels are graded numbers and compose by taking the maximum (§4.1). Role tags
on a binding are labels on a grant, not sets of permissions. The only
workspace-wide permissions today are `manage_ai` and `manage_coaching`.

## 1. The decisions Agung took

| Question | Decision |
|---|---|
| Shape | A role layer above the relationship model, not a replacement |
| Where a role lives | The workspace, one role per member |
| How fine the permissions are | Per domain, four columns: view, comment, edit, manage |
| Champion and reviewer | Unchanged and not editable: both carry METHOD duties |
| METHOD gates | Untouched. The phase gate and the six publish gates stay |

## 2. The model

Two tables and one column.

| Table | Holds |
|---|---|
| `workspace_roles` | A role: name, whether it is built in, whether it is the default for a new member |
| `role_permissions` | One row per role and domain, carrying a level |
| `workspace_members.role_id` | Which role this member holds. One, nullable during the rollout |

**A domain is an access resource type**, so the matrix plugs into the resolver
without a translation table: `goal`, `kpi`, `initiative`, `task`, `space`,
`comment`, `workspace`. A level is one of the four §4.1 numbers, or zero for
nothing at all.

**`can()` stays the single door.** `resolveMemberAccessLevel` already takes the
maximum over every binding that reaches a member. It gains one more source in
the same query: the level this member's role grants for the context's resource
type. Bindings and roles compose the way two bindings already do.

```
level = max(
  bindings reaching this member on this context,   -- champion, reviewer, named grants
  role_permissions[member.role][context.resource_type]
)
```

Nothing else changes. Row-level security is untouched, it is still the tenant
floor, and no endpoint checks anything for itself.

## 3. The four built-in roles

Seeded in the workspace-provisioning transaction, editable afterwards except
where marked.

| Domain | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| goal | manage | manage | edit | view |
| kpi | manage | manage | edit | view |
| initiative | manage | manage | edit | view |
| task | manage | manage | edit | view |
| comment | manage | manage | comment | view |
| space | manage | manage | view | view |
| workspace | manage | edit | view | view |

**Owner cannot be edited or deleted**, because a workspace that can lower its
own last administrator is a workspace nobody can repair. Every other role can
be edited, and roles can be added.

**Member holding `edit` on `goal` is the change Agung asked for, and it widens
access.** Today a member edits the objectives of spaces they belong to; after
this they edit any objective in the workspace unless an administrator lowers
the Member row. That is what "the role decides, not the space" means, and it is
said here rather than discovered.

## 4. Migration

| Who | Becomes |
|---|---|
| The workspace founder | Owner |
| Anybody who is a manager or a coordinator of any space | Admin |
| Every other active member | Member |
| A guest, an agent, a placeholder | No role. They keep exactly the bindings they hold |

**A guest gets no role on purpose.** A guest is somebody invited into one space
and holding nothing on the workspace context; giving them the default role
would hand them the whole workspace, which is the opposite of what their
invitation said.

The backfill runs through the data-change runner, not the migration, as
PLAN.md §5.1 requires.

## 5. Acceptance criteria

```
Given a member holding the Member role
When they open an objective in a space they do not belong to
Then they can edit it
And the audit row names them, not the space
```

```
Given an administrator who sets the Member role's goal permission to view
When a member holding that role opens any objective
Then the fields are read-only
And the add and delete controls are absent
```

```
Given a role that grants nothing on goal
And a member who is the champion of one objective
When they open that objective
Then they can still edit it, because the binding outranks the role
```

```
Given the Owner role
When an administrator opens the roles screen
Then Owner cannot be edited or deleted
And every other role can
```

```
Given a guest with no role
When they open the work map
Then they see what their space bindings give them and nothing more
```

## 6. The work, as four tasks

| Task | Deliverable |
|---|---|
| P8-G13a | The two tables, the column, the resolver change, the four built-in roles, the backfill |
| P8-G13b | The roles screen: the matrix, adding a role, assigning one to a member |
| P8-G13c | The objective's edit no longer comes from space membership: the `space_standard` binding drops to nothing on new goals, and a data change removes it from existing ones |
| P8-G13d | Fewer required fields: cycle setup defaults, champion and reviewer defaulting to whoever creates the objective |

P8-G13c depends on P8-G13a and must not land before it, or every member loses
the edit they hold through their space before any role gives it back.

## 7. What changes in the plan set

| Document | Change |
|---|---|
| TECHNICAL-PLAN §4.1 | The relationship model gains a role layer above it. The sentence "object authorisation is the relationship model through one `can()`" stays true: `can()` is still the one door, and a role is one more thing it reads |
| TECHNICAL-PLAN §4.14 | The settings map gains the default role for a new member |
| DATABASE.md | The two new tables and the new column |
| CLAUDE.md | The hard rule about object authorisation gains the role layer in the same sentence |
| METHOD.md | Nothing. That is the point of keeping the gates where they are |

## 8. What a role cannot do, and why the order of the tasks matters

**A role raises a level and never lowers one.** `can()` takes the maximum, so a
Viewer role granting `view` on `goal` does not stop somebody editing a goal
they hold an `edit` binding on. That is the same rule two overlapping bindings
have always followed, and changing it would mean a deny rule, which §4.1 does
not have and which is how an access model becomes impossible to reason about.

The consequence is the ordering already written in §6: the acceptance criterion
"an administrator lowers Member to view and the fields go read-only" is only
true once P8-G13c has removed the `space_standard` edit binding. Until then the
space binding still grants the edit the role no longer does. P8-G13a is
therefore additive by construction: every member keeps exactly what they had,
and gains whatever their role adds.

**That paragraph said list filtering could stay as it was, and it was wrong.**
It argued that every caller asks for `view` and every goal already carries a
workspace-wide `view` binding, so no list would change. The suite disagreed:
`access-visible-ids.test.ts` holds `visibleResourceIds` and
`getAccessScoped` to the same answer about the same resource, and a role read
by one and not the other breaks that at once. A list would hide a row the
detail screen then opens. `visibleResourceIds` reads the role layer too, by
the same rule.

`accessScopeFilter` is the remaining half and is genuinely untouched: its
callers all ask for `view`, which the workspace-wide binding already grants.
A list that asks for `edit` needs the role in that filter, and this note is
here so it is not discovered by somebody debugging an empty page.

## 9. What P8-G13c removed, and the one place it did not

Built 4 October 2026.

`createGoalInTx` no longer writes the `space_standard` binding at `edit`, and
data change 0013 removes the ones written before. The workspace role is now the
only thing that answers "who may edit this objective", which is what makes the
roles screen mean anything: before this, lowering Member on objectives changed
no level anywhere, because the space binding still granted the edit.

| What a space decides | Before | After |
|---|---|---|
| Who may see an objective in it | Everybody, through `workspace_standard` | Unchanged |
| Who may edit an objective in it | Every member of the space | The workspace role |
| Membership, the session cadence, the rails that read it | The space | Unchanged |

**Nobody loses the edit on the day this runs**, because 0012 runs first and
gives every active human the Member role, which grants `edit` on the `goal`
domain. The level is the same number from a different source. What changes is
that an administrator can now change it.

**The initiative followed, on Agung's answer.** The first version of this
section said an initiative in a space still granted its members `edit` through
the identical shape, that the two now disagreed, and that resolving it was a
decision rather than a tidy-up. Agung read that and asked for them to agree, so
`createInitiativeInTx` no longer writes the binding either and data change
0013 removes both. The owner keeps `full` through their own group, which is
what `initiatives.delete` asks for, and `workspace_standard` keeps `view`
on both, so alignment still reads across spaces.

## 10. What a review asks for, and why it changed

**Removing the binding took a Viewer out of the room, and that was wrong.**
Four review writes authorised through `edit` on the objective:
`sessions.scoreKeyResult`, `sessions.setNarrative`,
`sessions.decideObjective` and `sessions.revealObjectiveScore`. Every one of
them writes a review table and none of them writes the goal row. They read
`edit` only because a space used to grant every member `edit` on every
objective in it, so the check happened to pass for everybody in the room.

Once the binding went, somebody holding Viewer could no longer take part in a
quarterly review. METHOD.md §8.3 is the team scoring rather than the
facilitator scoring at them, so that is the practice breaking rather than the
matrix working.

| The check | Before | After |
|---|---|---|
| On the session | `edit`, which membership of the room grants | Unchanged |
| On the objective | `edit` | `view` |

Being in the room is what says somebody may grade. The objective check is the
right to see what is being graded, which is what it was always for. Nobody
outside the room gains anything: `requireQuarterly` still asks for the
session first.

## 11. A write that creates in a domain asks the role for that domain

Proposed and approved 23 October 2026, from MCP UAT BUG-002. Built the same
day: `domain` on `defineWriteAction`, `resolveMemberRoleLevel` in
`access/reads.ts`, and the floor in `operations/operation.ts`.

**What the UAT found.** A member holding Viewer, which grants 10 on every
domain, created a comment on a goal and created a KPI. Editing a goal, creating
a goal and creating a task were refused, as the matrix says.

**Why.** Every member holds `edit` on the workspace's own context, twice:

| Binding | Written by | Why it exists |
|---|---|---|
| `workspace_standard` at `edit` | `packages/core/src/workspaces/provisioning.ts` | Self-service: own profile, notifications, tokens, reading the workspace aggregate |
| The member's own group at `edit` | `packages/core/src/invitations/provisioning.ts` | The same, written on join |

§0 lists `workspace_standard` at `view`. That row is about the objective's
context; on the workspace context the binding is `edit`. The difference was
never written down, and it is the whole bug.

An action that names no subject is measured on the workspace context
(TECHNICAL-PLAN §8.1, layer 3). `comments.create` asks `comment` there and its
parent check asks `view`; `kpis.create` asks `edit` and has nothing to load. Both
clear the floor through the self-service binding, so the role is never read.
Goals and tasks are refused because their own getter measures the goal's or the
space's context, where the role does apply.

### The change

| Today | Proposed |
|---|---|
| A write with no subject is measured on the workspace context | A write that **declares a domain** is measured on that domain: the level the actor's role grants for it, or the level on the subject when it names one |
| The role reaches only aggregates that have a context | The role also decides who may create the first row of a domain |
| No action says which domain it belongs to | `defineWriteAction` takes an optional `domain`: `goal`, `kpi`, `initiative`, `task`, `comment` or `space` |

**This is not a deny rule and nothing is lowered.** The self-service binding
keeps answering what it was written for. A KPI is not the workspace, so the
workspace's binding was never the right thing to ask. The floor still takes the
maximum of what reaches the actor *on the context it measures*.

**Actors without a role keep today's rule.** A guest, an agent and a
placeholder hold no role (§4). For them a domain write is measured on the
subject when it names one, otherwise on the workspace context exactly as now,
so an agent bound to one space keeps writing there.

**No data change.** No binding is removed or rewritten, so nothing stored
changes and a rolling upgrade is safe.

### Which actions get a domain

From a scan of every `defineWriteAction` that asks below `full` and names no
subject. Writes whose own getter already measures a goal, a space, a session or
a task are left as they are, because the role already reaches them there.

| Domain | Actions |
|---|---|
| comment | `comments.create`, `comments.update`, `reactions.add` |
| kpi | `kpis.create`, `kpis.createCategory`, `kpis.createTree`, `kpis.record`, `kpis.deleteRecord`, `kpis.update`, `kpis.setFormula`, `kpis.launchRecovery`, `kpis.recordResponse` |
| initiative | `initiatives.create`, `initiatives.linkKeyResult`, `initiatives.unlinkKeyResult` |
| Unchanged (self-service on the workspace) | `people.updateOwnProfile`, `people.setLeave`, `people.finishOwnTour`, `notifications.*`, `subscriptions.toggle`, `tokens.*`, `connections.revoke`, `ai.setPersonalCredential`, `ai.removePersonalCredential`, `channels.*Link*`, `nudges.snooze`, `copilot.*`, `invitations.acceptLink`, `invitations.joinByTrustedDomain` |

`comments.delete` and `reactions.remove` stay on the author's own row: taking
back what you wrote is not creating in a domain.

The list is checked by `write-floor-classification.test.ts`, which walks the
registry: every write below `full` either declares a domain, is on the
self-service list, or is on the list of writes measured by their own check on a
goal, space, session, task, cycle, document or the author's own row. A new
action fails it until somebody chooses, so none slips past by naming nothing.

### Acceptance criteria

```
Given a member holding Viewer (10 on every domain)
When they call comments.create on a goal they can read
Then it is refused with "comments.create needs a higher access level than you hold."
And no comment is written
```

```
Given a member holding Viewer
When they call kpis.create
Then it is refused the same way
```

```
Given a member holding Member (comment 40, kpi 70)
When they comment on a goal and create a KPI
Then both succeed, as today
```

```
Given a member holding Viewer
When they update their own profile, mark a notification read or mint a token
Then each succeeds, because self-service still reads the workspace binding
```

```
Given an agent with no role, bound at edit to one space
When it creates a task in that space
Then it succeeds, as today
```

### Open questions

| Question | Proposed answer |
|---|---|
| Should a Viewer keep reacting to a comment? | No: a reaction is a comment-domain write. Viewer means reading |
| Should a Viewer still use the copilot? | Yes: asking is reading, and every proposal it makes goes through the review queue, where applying it is measured on its own action |

## 12. An Admin sets up a cycle (plan 0.8.0 R1)

**Approved by Akmal on 11 November 2026** ("design approved"), with every open question answered as recommended.

Asked on 10 November 2026: how does somebody set a cycle's sponsor? Recommended
by Claude and agreed by Akmal the same day, as plan row R1. This section is the
design R1's gate asks for. It needs "design approved" before the code.

### What is true today

| Fact | Where |
|---|---|
| `cycles.create` and `cycles.update` (roles, phase, levels, planning session dates, publication deadline) ask `full` and name no domain, so they are measured on the workspace context | `packages/core/src/actions/cycles.ts` |
| On the workspace domain only the Owner holds `full`. An Admin holds `edit` there on purpose (§3) | `packages/core/src/access/roles.ts` |
| So an Admin cannot create a cycle, name its sponsor or facilitator, or book its planning sessions. Whoever creates a cycle becomes its sponsor by default | `apps/web/app/cycle/page.tsx`, `canPublish = level >= full` |
| **Every member already holds `edit` on the workspace context**, through the self-service binding (§11). Lowering these actions to `edit` and nothing else would hand the cycle to every Member, not only to the Admin | `packages/core/src/access/reads.ts`, `workspace_standard` |
| The page's own `level` comes from the same context, so it cannot tell an Admin from a Member either | `apps/web/app/cycle/page.tsx`, `resolveAccessLevelFor` |

### The change

The cycle's setup writes join §11: each declares the domain `workspace` and asks
`edit`. A member holding a role is then measured by what the role grants on
the workspace domain, and the self-service binding is not consulted for them.

| Actor | Workspace level that decides | Sets up a cycle |
|---|---|---|
| Owner | The role: `full` | Yes, as today |
| Admin | The role: `edit` | **Yes, new** |
| Member, Viewer | The role: `view` | No, as today |
| A role a workspace made | Its own workspace level | Yes when it grants `edit` or more |
| Guest invited to a space | No role, so §11's old rule: no workspace binding, so nothing | No, as today |
| Agent | No role, and an agent can never be bound on the workspace | No, as today |
| Support session | No role reaches it (the role read is for humans), so its binding: the level the owner granted | Yes when the owner granted `edit` or more. Today only at `full`. See R1-Q4 |

**No new role, no new domain, no migration and no data change.** Admin's
workspace row stays `edit`, so an Admin still cannot reach the settings, the
plan, the roles or the handover, which ask `full`.

**The screen asks core, not the level.** A read of its own, `cycles.setupAccess`,
answers `canSetUp` from the same floor the writes run (`writeFloorFor` in
`packages/core/src/operations/operation.ts`, beside `floorLevel`). It is its own
read rather than a field on `workflow.read`, as first proposed, because the page
needs the answer before any cycle exists, to draw the create. The cycle page
draws the Roles and planning sessions card, the annual frame and objectives, the
publish and close controls, and the create and deadline card on it, in place of
`level >= full`, so the page and the server cannot disagree. The archive control
is drawn on `full`, as R1-Q3 decided. F1's
destinations at `full` read it too, and its sentence for a reader who cannot act
becomes "An Owner or an Admin fills this in."

### Which actions move

| Action | What it does | Today | Proposed |
|---|---|---|---|
| `cycles.create` | Creates the cycle for a period | `full` | `edit`, domain `workspace` |
| `cycles.update` | Roles, phase, levels, session dates, publication deadline, contributing units, first cycle | `full` | `edit`, domain `workspace`. One action for one form; splitting the fields would be a second action for the same card |
| `frame.set` | The annual frame: mission, strategies, what not to do | `full` | `edit`, domain `workspace` (R1-Q1). An Admin already writes company objectives, which hold `full` on the goal domain; the frame is the text those objectives answer to. Revising an agreed frame still needs a written reason and is kept |
| Phase 0's annual objectives card | Sends the year's objectives forward, through `goals.create` | Drawn for `full` | Drawn for `canSetUp` (R1-Q1). The write is on the goal domain, where the server already lets an Admin |
| `workflow.publish` | Publishes the set once the gates allow it | `full` | `edit`, domain `workspace` (R1-Q2). The publish gates still decide whether it may happen; this decides only who presses the button |
| `cycles.setClosing`, `cycles.close` | Starts closing early; closes once phase 7 is complete | `full` | `edit`, domain `workspace` (R1-Q2). The end of the cycle the Admin set up |
| `cycles.archive` | Takes a cycle out of every list | `full` | **Stays** (R1-Q3) |
| `rhythm.update` | The workspace's deviations from the method's thresholds, and its terminology | `full` | **Stays**. A practice setting (METHOD.md §12), on the admin screens |
| `cycles.ensureCurrent` | Creates the current period's cycle if none exists | `edit`, any human member | Unchanged. Drafting a goal relies on it, and it names no roles |

### Acceptance criteria

```
Given a workspace with an Owner, an Admin, a Member and a Viewer
When the Admin creates a quarterly cycle and names the Member its sponsor
Then the cycle exists with that sponsor, and the audit row names the Admin

Given the same workspace
When the Member calls cycles.create or cycles.update
Then it is refused with "cycles.create needs a higher access level than you hold."
And nothing is written

Given a role the workspace made with workspace at edit
When a member holding it creates a cycle
Then it is created

Given an agent bound to a space, or a guest invited to one
When it calls cycles.create
Then it is refused

Given the Admin on the cycle page in Phase 1
Then the Roles and planning sessions card is drawn and saves
And for the Member it is not drawn, and "Still needed here" says
  "An Owner or an Admin fills this in."
```

### Tests

| Test | Kind |
|---|---|
| Every actor in the table above, for each action that moves, allowed or refused | Core, against a real database, `packages/core/test/cycle-setup-access.test.ts` |
| `canSetUp` from `cycles.setupAccess` agrees with the write for every actor in the table | Same file |
| The moved actions are listed under the `workspace` domain | `write-floor-classification.test.ts`, the existing walk of the registry |
| The page draws the setup cards on `canSetUp`, and F1's sentence | Unit, `apps/web/test` |
| An Admin made through the suite's helpers (`joinAsNewcomer`, `makeAdministrator` in `e2e/hosting.ts`) names a sponsor on `/cycle` | End to end, `e2e/s04b-admin-sets-up-cycle.spec.ts` |

The contract artifacts carry each action's access level, so `pnpm gen:contract`
runs in the same change.

### What the specification gains

TECHNICAL-PLAN §4.1, the role matrix's note on the workspace domain: running a
cycle is `edit` on the workspace domain, and the settings stay `full`. UIUX-PLAN
S-04 and S-06: the setup cards are drawn for whoever can set up the cycle.

### Open questions

| # | Question | Options | Recommended |
|---|---|---|---|
| R1-Q1 | Do the annual frame and the annual objectives card move with the cycle? | Move; or stay with the Owner | **Move.** Whoever runs the planning writes down what leadership agreed, and an Admin can already write the company objectives the frame explains |
| R1-Q2 | Do publishing and closing move? | Move; or stay with the Owner | **Move.** Leaving them with the Owner makes the Owner a step in every quarter, and the gates, not the role, decide whether the set is ready |
| R1-Q3 | Does archiving a cycle stay with the Owner? | Stay; or move | **Stay.** It changes what every member's lists show and is not part of running a cycle |
| R1-Q4 | A support session the owner granted at `edit` can now set up a cycle. Accept? | Accept; or measure a support guest by the role it carries | **Accept.** The owner chose the level, and every write in the session is audited under the operator's own member row, like any member's |

## 13. A new objective asks the goal role (UAT 0.8.0 F-04)

Found by the 0.8.0 acceptance test and approved by Akmal on 11 November 2026
("design approved"). A completion of §11, not a new rule.

**What the test found.** A member holding Viewer saw "Start drafting" on the
Work Map and "Add objective" on Phase 4, and the server created the objective.
§11 says creating a goal was refused; that held only for a goal filed under a
space, where `goals.create` checks `edit` on the space itself. A company-level
or a member's own objective names no subject, so it was measured on the
workspace context, where every member holds `edit` for self-service, and the
role was never read. The write-floor walk listed `goals.create` under "checks
its own subject", which was true for one owner kind of three.

### The change

| Where | Today | Changed |
|---|---|---|
| `goals.create` | No `domain`; measured on the workspace context unless the goal names a space | `domain: "goal"`, so the floor is the role's goal level, as `kpis.create` and `comments.create` are (§11). The space check stays for a goal filed under a space |
| A screen that offers to create an objective | Drawn on the workspace level, which is `edit` for everybody | Drawn on `goals.createAccess`, a read answered by the floor the write runs (`writeFloorFor`, as `cycles.setupAccess` does in §12), so the two cannot disagree |

The screens: the Work Map's "Start drafting" (plan 0.8.0 L2, whose sentence for
a reader who cannot draft becomes reachable), Phase 4's drafting, "+ New
objective" on Goals, "+ New, Objective" in the top bar, the product tour's
"Start drafting OKRs" step and the command palette's "Create objective".

**Who is affected.** Only a Viewer, and any custom role below `edit` on goals.
Owner and Admin hold `manage` and Member holds `edit` on the goal domain, so
they create as before. Actors with no role, an agent or a guest, keep §11's
rule for actors without one. No binding changes, so nothing stored changes.

### Acceptance criteria

```
Given a member holding Viewer
When they call goals.create for a company objective or their own
Then it is refused with "goals.create needs a higher access level than you hold."
And no goal is written

Given a member holding Member
When they create a company objective
Then it is created, as today

Given a member holding Viewer
When they open the Work Map of a cycle with no objectives
Then they see the sentence and no "Start drafting" button
And goals.createAccess answers canCreate false, and true for a Member
```

### Tests

| Test | Kind |
|---|---|
| Viewer refused and Member allowed for `goals.create`; `goals.createAccess` agrees with the write | Core, `packages/core/test/role-domain-floor.test.ts` |
| `goals.create` is listed under the `goal` domain | `write-floor-classification.test.ts` |
| A Viewer sees no "Start drafting" on the Work Map | End to end, `e2e/s04b-admin-sets-up-cycle.spec.ts`, which already makes members of each role |
