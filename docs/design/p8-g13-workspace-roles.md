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

**List filtering is untouched in P8-G13a.** Every caller of `accessScopeFilter`
asks for `view`, and every goal already carries a workspace-wide `view`
binding, so no list changes. A list that one day asks for `edit` would need the
role in that filter too, and the note is here so it is not discovered by
somebody debugging an empty page.
