# Access to one KPI, and FlowyTeam's KPI shares

Status: **design approved by Agung on 19 November 2026**, every open question (Q1 to Q8) answered as recommended in this document. Rewritten the same day after the review in docs/audits.

Release: 0.10.0, row G4 of the [release plan](../plans/release-0.10.0.md). Akmal approved the direction on 19 November 2026 (G4-Q1, G4-Q2 in §7 of that plan). This document is the design those answers asked for. It needs an explicit "design approved" before code, because it carries a migration and a change to access (CLAUDE.md, "Three kinds of change start with the design").

Terms used below:

| Term | Meaning |
|---|---|
| Context | A row in `access_contexts`. One per protected resource. Access is granted on a context |
| Binding | A row in `access_bindings`: a group holds a level on a context, optionally with a tag |
| Member group | An `access_groups` row of kind `member`. It names one person |
| `workspace_standard` | The group every active human member belongs to by definition. It never reaches a guest, an agent or a placeholder |
| Level | `view` 10, `comment` 40, `edit` 70, `full` 100 (`packages/core/src/access/levels.ts:13-18`). Roles call `full` "manage" (`docs/design/workspace-roles.md:34`) |
| Straggler | A live KPI with no `kpi` context of its own. Every KPI in a space is one today. After this release only a KPI created by an old pod during a rolling upgrade can be one |

## 1. What is true today

Every line was checked against `feat/0.10.0-designs` at `3c39ffb1`.

### 1.1 The access model

| Fact | Where |
|---|---|
| Levels: `view` 10, `comment` 40, `edit` 70, `full` 100 | `packages/core/src/access/levels.ts:13-18` |
| Built-in roles on the `kpi` domain: Owner `full`, Admin `full`, Member `edit`, Viewer `view`. Admin holds only `edit` on `workspace` | `packages/core/src/access/roles.ts:72-134` (Admin workspace line 102) |
| A guest, an agent and a placeholder hold no role. A role may be edited, except Owner | `docs/design/workspace-roles.md:100`, `roles.ts:137` |
| `resolveMemberAccessLevel(tx, {workspaceId, memberId, contextId})` returns the maximum of the role level on the context's `resource_type` and every reachable binding on that one context. Contexts have no parent column, so nothing cascades from a space to what is in it | `packages/core/src/access/reads.ts:52-169`, `packages/db/migrations/0009_access_model.sql:19-27` |
| A suspended, deleted or non-active member resolves to 0 on every context. Their bindings stay and resolve again on restore | `reads.ts:68-72` |
| `can(tx, {workspaceId, memberId, contextId}, level)` is a one-line predicate over the function above | `reads.ts:221-229` |
| `getAccessScoped(tx, {workspaceId, memberId, resourceType, resourceId, requires?})` resolves the subject through `SUBJECT_RESOLVERS` and throws `not_found` below the level | `reads.ts:830-871` |
| `SUBJECT_RESOLVERS` has `workspace`, `blob`, `space`, `goal`, `initiative`, `task`, `document`, `comment`, `reaction`. No `kpi` | `reads.ts:492-587` |
| `visibleResourceIds(tx, {workspaceId, memberId, resourceType, ids, requires?})` returns a `Set<string>` of the ids the member may see. It already has the role layer, joined on `rp.domain = c.resource_type` | `reads.ts:873-1014` (role layer 979-1011) |
| `accessScopeFilter(column, {...})` is the SQL filter search and the feed use. It reads bindings only, with no role layer | `reads.ts:394-443` |
| `bindGroup` only raises a held level and never lowers it. One live untagged binding per group and context, one per tag | `packages/core/src/access/contexts.ts:252-293`, `0009_access_model.sql:145-155` |
| `unbindGroup` without a `tag` soft-deletes every binding of that group on that context | `contexts.ts:312-328` |
| `access_bindings.tag` is checked against `champion`, `reviewer`, `sponsor`, `facilitator`, `coordinator`. No later migration changes it | `0009_access_model.sql:69-70`, `packages/db/src/schema/access.ts:91-93` |
| The three access tables already have `workspace_id`, forced row-level security and the `tenant_isolation` policy | `0009_access_model.sql:75-98` |
| A goal context holds `workspace_standard` at view, the space's `space_standard` at edit, the champion at full (tag `champion`) and the reviewer at edit (tag `reviewer`) | `packages/core/src/goals/service.ts:5-20` |
| A guest in a space gets a member-group binding at view on the space context only. Neither standard group reaches a guest | `packages/core/src/spaces/service.ts:13-19, 358-384` |

### 1.2 KPIs

| Fact | Where |
|---|---|
| `kpis.create` creates a context only for a KPI with no space, and binds the Champion and the Coach to it | `packages/core/src/actions/kpis.ts:479-489` |
| No KPI action passes `subject` to the Operation pipeline. Writes declare `domain: "kpi"`, so the floor is the role on `kpi` | `kpis.ts` (no `subject:`), `packages/core/src/operations/operation.ts:389-438` |
| `kpis.update` changes `ownerMemberId` at `edit` | `kpis.ts:1125-1158, 1304-1310` |
| A KPI owner may be a placeholder. An agent is refused | `kpis.ts:260-295` |
| Reads at `view` are not enforced by the builder. **Any member, a guest included, can call `kpis.list` and `kpis.grid` and receive every KPI in the workspace.** The same holds for `kpis.detail`, `kpis.tree`, `kpis.recoveryBoard` and `kpis.recoveryDraft`, which check nothing either | `packages/core/src/actions/define.ts:332-346`; `kpis.ts:732-944, 946-1005, 1709+, 2040+, 2228+, 2493+` |
| `kpis.spaceTrees` checks `view` on the space, then returns every KPI in it | `kpis.ts:2157-2163` |
| There is no `kpis.delete`, `kpis.get` or `kpis.records` action. The KPI actions are listed in §7 | `packages/core/src/actions/registry.ts:955-970, 1036-1037` |
| `agentSeesKpi` lets an agent see a KPI bound on the KPI context or on its space context | `packages/core/src/agents/scope.ts:103-108` |
| Data change 0009 did the agent binding work in raw SQL, because `packages/db` cannot import `packages/core` | `packages/db/src/data-changes/0009_bind_agents_to_spaceless_items.ts` |
| The next data change number is 0037. The next migration number is 0172 | `packages/db/src/data-changes/registry.ts:47`, `packages/db/migrations/0171_member_content_width.sql` |

### 1.3 Imports and the old share table

| Fact | Where |
|---|---|
| `people.importMember` creates placeholders: `kind = 'placeholder'`, `status = 'active'`, no `user_id` | `packages/core/src/actions/people.ts:1283, 1401, 1411` |
| A placeholder becomes `kind = 'human'` when somebody signs up with its address | `packages/core/src/invitations/provisioning.ts:201-298` |
| The importer acts as the human named by `--as`. There is no system importer identity | CLAUDE.md "Importer rules", `packages/importer/src/flowyteam/domains.ts:56-67` |
| `indicator_accesses` is listed as unread | `packages/importer/src/flowyteam/unread.ts:91-94` |
| FlowyTeam `indicator_accesses` columns: `indicator_id`, `user_id`, `occurance`, `permissions` (`read` / `update`), `view_options` (`me` / `manager` / `team` / `everyone`), `department_id`. The reference names no visibility flag on `indicators` | `docs/specification/reference/flowyteam-okr-kpi-tasks-model.md:200-224, 259` |
| `kpi_shares` exists (migration 0026) with RLS. Nothing writes it. Two lists name it | `packages/db/migrations/0026_kpis.sql:185-206`, `packages/core/src/portability/policy.ts:762`, `packages/core/src/people/export.ts:233` |
| TECHNICAL-PLAN §4 names `kpi_shares` as the home of narrow sharing | `docs/specification/TECHNICAL-PLAN.md:160` |
| `access_bindings` has no grantor and no legacy column | `packages/db/src/schema/access.ts:78-98` |

### 1.4 Corrections to the first draft

| Draft said | True |
|---|---|
| `full` is 90 | 100 |
| The KPI context sits under the space context | Contexts have no parent. Space bindings do not reach a KPI |
| `visibleResourceIds` can return null | It returns a `Set` |
| `can(actor, "kpis.read", subject)` | `can(tx, {workspaceId, memberId, contextId}, level)`. There is no `kpis.read` |
| `kpis.get`, `kpis.records`, `kpis.delete` | Not actions. See §7 |
| Screens S-23, S-24, `/admin/import` | KPI screens are S-20 `/kpis`, S-21 `/kpis/[id]`, S-18 `/kpis/trees`, S-19 `/kpis/recovery`. The FlowyTeam importer is command line only |
| The data change calls `bindAgentsToContextInTx` | A data change is raw SQL |
| A system importer actor | The `--as` human |
| `kpi_shares` is unread | Named in two lists (above) |
| `kpis.shares` returns a grantor | No grantor column exists |
| `SUBJECT_RESOLVERS` at line 479 | Line 492 |
| Viewers see only shared KPIs | Viewers hold `kpi: view` and see every KPI |

## 2. Decisions

| # | Decision | Reason |
|---|---|---|
| KA-D1 | Every KPI owns a `kpi` context, in a space or not. New KPIs get it at creation. Data change 0037 gives existing KPIs one | One rule for every KPI. Shares need a context to live on |
| KA-D2 | Every KPI context holds `workspace_standard` at `view`, untagged | Keeps today's answer for human members on every surface, including `accessScopeFilter`, which has no role layer. The narrowing reaches only actors with no blanket tier: guests. A custom role at 0 on `kpi` still reads every KPI, as it does for goals; a role never lowers access. Writes stay narrowed by the role. This differs from review nit 16, which assumed no blanket binding |
| KA-D3 | No `space_standard` binding on a space KPI's context | Keeps today's behaviour: a Viewer in a space stays at `view` on its KPIs. Open question Q2 asks Akmal |
| KA-D4 | The owner's member group holds `full`, tag `owner`. Written on create, on owner change, by 0037, and for the importer's KPIs through `kpis.create` | Akmal's G4-Q1 gives the owner grant authority. `ownerMemberId` is a column, so without a binding a Member owner resolves to 70 |
| KA-D5 | Changing a KPI's owner needs `full` on the KPI | Blocks the escalation in review finding 2: an `edit` holder naming themselves owner |
| KA-D6 | A share is a binding with tag `share`, level `view` or `edit`, on the grantee's member group. A share sets the level exactly; lowering is allowed for the `share` tag only. `kpis.unshare` removes the `share` binding and nothing else | `bindGroup` only raises and untagged `unbindGroup` would also remove the owner binding (review finding 4) |
| KA-D7 | Share authority is `full` on the KPI: the owner binding, or a role granting manage on `kpi` | The level model has no "Owner or Admin" test; roles are editable (workspace-roles.md §3). Differs in wording from what Akmal approved, so Q1 asks |
| KA-D8 | Bindings replace `kpi_shares`. The table stays unread and unwritten in 0.10.0 and is dropped in a later release under PLAN §5.1. TECHNICAL-PLAN §4, DATABASE.md, the portability policy and the people export are updated in the same slice | One store for grants. TECHNICAL-PLAN outranks this document, so the change is made there and needs approval with this design |
| KA-D9 | Agents are bound to a KPI context only when the KPI has no space, as today. `kpis.share` refuses an agent | Least privilege. Binding agents on every KPI would let an agent unbound from a space keep seeing its KPIs through `agentSeesKpi` (review finding 8) |
| KA-D10 | Rolling upgrade: option 1 of review finding 5, adjusted. A straggler resolves to the workspace context in `SUBJECT_RESOLVERS`. KPI code never calls `getAccessScoped` for a KPI; it calls the new `requireKpiAccess`, which gives a straggler the role level only. Removed in 0.11.0. Detail in §4 | Ships G4 in one release, as Akmal decided. A reader never sees less than today mid-upgrade, and the workspace context's `edit` never reaches a KPI write |
| KA-D11 | A share covers only that KPI. A parent, a child and a formula source keep their own access | Additive and predictable. Q3 asks |
| KA-D12 | `kpis.share`, `kpis.unshare` and `kpis.importShare` are `agentSurface: false`. `kpis.shares` is on the agent surface in the `work` toolset | Changing who sees what stays with a person in the browser or the command line. Reading the list is harmless at the same level as the KPI |
| KA-D13 | Erasing a member soft-deletes their `owner` and `share` bindings on KPI contexts. Suspension leaves them; they resolve again on restore | An erased person has nobody behind them. A suspension is reversible |
| KA-D14 | The importer writes a share for a placeholder. "Covered by current role" is information, the binding is still written | Almost every imported person is a placeholder (review finding 6). A role can be lowered later, and the share should still hold then |
| KA-D15 | Import idempotency uses the audit trail as the ledger: each `kpis.importShare` audit row carries the source key. A key already imported is never written again, so a share an admin revoked stays revoked | `access_bindings` has no legacy column, and a new ledger table would be a second schema change |
| KA-D16 | No notification to the grantee in 0.10.0 | A notification is a new message kind, which needs Akmal (Q5) |
| KA-D17 | A share does not reach `kpis.deleteRecord`, `kpis.launchRecovery`, `kpis.recordResponse` or `kpis.createTree`. These need the role (`kpi` at `edit`) | Deleting a reading is destructive and cannot name a subject (`operation.ts:209-216`). The other three create or link objectives, tasks or trees, which a KPI share does not cover |

## 3. Data model and migration

### 3.1 What a KPI context holds

| Principal | Level | Tag | Written by |
|---|---|---|---|
| `workspace_standard` | view | none | create, 0037 |
| Owner's member group | full | `owner` | create, owner change, 0037 |
| Grantee's member group | view or edit | `share` | `kpis.share`, `kpis.importShare` |
| Champion and Coach member groups | view | none | create and data change 0009, only when `space_id` is null (unchanged) |

### 3.2 Migration 0172 (schema, additive)

File `packages/db/migrations/0172_access_binding_owner_share_tags.sql`:

```sql
alter table access_bindings drop constraint access_bindings_tag_check;
alter table access_bindings add constraint access_bindings_tag_check
  check (tag in ('champion', 'reviewer', 'sponsor', 'facilitator',
                 'coordinator', 'owner', 'share')) not valid;
alter table access_bindings validate constraint access_bindings_tag_check;
```

| Point | Answer |
|---|---|
| Constraint name | Postgres names the inline check from 0009 `access_bindings_tag_check`. Confirm with `\d access_bindings` before writing the file |
| `not valid` then `validate` | The add takes a short lock; validation scans without blocking writes |
| Additive under PLAN §5.1 | Widens the allowed set. Old code never writes the new tags. Old code reading a tagged row takes its level in the maximum, which is correct |
| Row-level security | Unchanged. No new table. `access_bindings` keeps its 0009 policy |
| Drizzle | `packages/db/src/schema/access.ts:91-93` enum gains `owner` and `share`, so `AccessRoleTag` includes them |
| `kpi_shares` | Untouched in this release (KA-D8) |
| Lint | `pnpm db:lint` (new file, no edit to a shipped migration) |

### 3.3 Data change 0037

File `packages/db/src/data-changes/0037_kpi_contexts_and_owner_bindings.ts`, registered in `registry.ts`. Raw SQL through `DataChangeClient`, as 0009 does. Batched by workspace, 100 per batch, cursor is the last workspace id. Idempotent: every insert is guarded by `not exists`, so a second run changes 0 rows.

`expects`: `kpis.owner_member_id` uuid, `kpis.space_id` uuid, `access_contexts.resource_id` uuid, `access_bindings.tag` text, `access_groups.member_id` uuid, `search_documents.context_id` uuid, `activities.context_id` uuid.

Per workspace, in this order:

| Step | SQL shape |
|---|---|
| 1 Contexts | `insert into access_contexts (id, workspace_id, resource_type, resource_id)` one row per live KPI with no live `kpi` context. `id` from `newId()` in the script, as 0009 does |
| 2 Standard binding | `insert into access_bindings (..., level, tag)` `workspace_standard` group at 10, tag null, on every live `kpi` context lacking a live untagged binding for that group |
| 3 Owner groups | `insert into access_groups (id, workspace_id, kind, member_id)` kind `member` for each owner with no live member group. Owner must be a live member with `kind <> 'agent'` |
| 4 Owner binding | Insert level 100, tag `owner`, for each KPI with a live owner and no live `owner` binding on its context |
| 5 Search | `update search_documents set context_id = <kpi context>` where `entity_type = 'kpi'` and `entity_id` is the KPI |
| 6 Feed | `update activities set context_id = <kpi context>` where `subject_type = 'kpi'`, `subject_id` is the KPI and `context_id is null` |

Not done by 0037:

- No agent bindings. Spaceless KPIs were bound by 0009 and by `kpis.create`.
- Past `kpi.created` activities keep the workspace as their subject, because their payload holds no KPI id (`kpis.ts:493-502`). Their title stays visible to whoever reads the workspace context. Recorded, not fixed.
- No audit rows. A data change has no actor and runs outside the Operation pipeline, as 0009 did. Accepted explicitly; the ledger row records the run.

### 3.4 Documents updated in the same slices

| Document | Change |
|---|---|
| `docs/specification/TECHNICAL-PLAN.md:66` | `access_contexts`: "every KPI", not "a KPI that belongs to no space" |
| `TECHNICAL-PLAN.md:69` | `access_bindings.tag` adds `owner`, `share` |
| `TECHNICAL-PLAN.md:160` | `kpi_shares` row: replaced by `access_bindings` tagged `share` (KA-D8), table retired |
| `TECHNICAL-PLAN.md:503, 529, 542` | §7.2: `indicator_accesses` imported through `kpis.importShare` into `share` bindings; report rules from §8 |
| `docs/specification/DATABASE.md:160, 401` | Tags; `kpi_shares` marked retired |
| `packages/core/src/portability/policy.ts:762` | Reason: "Retired in 0.10.0, never written. Shares live in access_bindings" |
| `packages/core/src/people/export.ts:233` | Same retirement note, still skipped as access |
| `packages/importer/src/flowyteam/unread.ts:91-94` | Entry removed |

## 4. Rolling upgrade

**Chosen: review option 1, with two changes.** Option 2 (contexts in 0.10.0, enforcement in 0.11.0) would move the guest narrowing and Viewer shares out of 0.10.0, which Akmal assigned to 0.10.0.

Change 1, the fallback reaches reads only. The workspace context gives every human `edit` through `workspace_standard` (`operation.ts:203-205`). So the `kpi` resolver may fall back to it for the generic consumers (search, notifications, the feed, the floor), and KPI actions do not use that answer for writes:

| Consumer | KPI with own context | Straggler |
|---|---|---|
| `SUBJECT_RESOLVERS.kpi` (new `kpiContextResolver`) | Own context | The workspace context, when the KPI row is live. `undefined` for a deleted or unknown KPI |
| `requireKpiAccess` (new, §5) | Level on own context | The member's role level on `kpi`; at `view`, also any active human. Guests get not-found |
| `visibleKpiIds` (new, §5) | `visibleResourceIds` | Same rule as `requireKpiAccess` |
| The Operation floor | `max(role, level on context)` | `max(role, level on workspace context)`. Coarse. `requireKpiAccess` inside the handler decides |

Change 2, the switch is not the ledger. Data change 0037 can finish while an old pod still serves `kpis.create` and writes a straggler. So the fallback stays for all of 0.10.x.

0.11.0 then (recorded here, built there):

1. Data change `0038_kpi_contexts_sweep`, the same SQL as 0037 under a new name.
2. A 0.11.0 migration naming it with `-- openokr:requires-data-change: 0038_kpi_contexts_sweep`. The migrator is the Helm pre-upgrade hook (`deploy/helm/templates/migration-job.yaml:16`), so the sweep finishes before 0.11.0 pods serve (`packages/db/src/migrate.ts:11-15`).
3. `kpiContextResolver` becomes `ownContextResolver("kpi")` and the straggler branches of §5 are deleted.
4. `kpi_shares` dropped (second release of KA-D8).

Mid-upgrade limits, accepted:

- A Member who owns a straggler cannot change its owner until 0037 reaches it, because the floor runs before the handler can create the context.
- A guest who holds a binding on the workspace context finds a straggler in search. That is narrower than today, where every guest reads every KPI.

## 5. Access resolution

New module `packages/core/src/kpis/access.ts`. Every function takes the Operation's or the read's own transaction.

| Function (new) | Signature | What it does |
|---|---|---|
| `ensureKpiContextInTx` | `(tx, {workspaceId, kpiId}) => Promise<string>` | Returns the live `kpi` context id, creating it when missing with the bindings of §3.1. Insert uses `on conflict do nothing` on `access_contexts_resource_idx`, then selects, so two concurrent callers end with one row |
| `requireKpiAccess` | `(tx, {workspaceId, memberId, kpiId, requires}) => Promise<{contextId: string \| null; level: number}>` | Throws `not_found` for a missing or deleted KPI and for a level below `requires`. With a context: `getAccessScoped(tx, {workspaceId, memberId, resourceType: "kpi", resourceId: kpiId, requires})`. Straggler: §4 rule using `resolveMemberRoleLevel` and `accessFilterMember` |
| `requireKpiRole` | `(tx, {workspaceId, memberId, requires}) => Promise<void>` | `resolveMemberRoleLevel(tx, {workspaceId, memberId, domain: "kpi"})` must be at least `requires`, else `forbidden`. For the actions of KA-D17 |
| `visibleKpiIds` | `(tx, {workspaceId, memberId, ids, requires?}) => Promise<Set<string>>` | `visibleResourceIds(tx, {workspaceId, memberId, resourceType: "kpi", ids, requires})` plus stragglers that pass the §4 rule. Two statements, whatever the number of ids |
| `setKpiShareInTx` | `(tx, {workspaceId, contextId, memberId, level}) => Promise<{previous: 10 \| 70 \| null}>` | `ensureMemberGroup`, then insert or update the live `share` binding to exactly `level` |
| `removeKpiShareInTx` | `(tx, {workspaceId, contextId, memberId}) => Promise<{previous: 10 \| 70 \| null}>` | `unbindGroup(tx, {workspaceId, groupId, contextId, tag: "share"})` |
| `rebindKpiOwnerInTx` | `(tx, {workspaceId, contextId, from: string \| null, to: string \| null}) => Promise<void>` | `unbindGroup` with tag `owner` for `from`; `bindGroup` at 100 with tag `owner` for `to` |

**Rule for KPI code:** never call `getAccessScoped` with `resourceType: "kpi"` directly. Call `requireKpiAccess`. A unit test asserts a Viewer is refused `edit` on a straggler through it.

| Case | Result |
|---|---|
| Owner (any role, a placeholder included) | `full` through the `owner` binding. A placeholder's binding is used once somebody claims it, because nobody can act as a placeholder before |
| Owner change | Needs `full` (KA-D5). The old owner's `owner` binding is removed, the new one written. Null owner: removed only |
| Share authority | `full` on the KPI: the owner binding, or a role granting manage on `kpi` (KA-D7, Q1) |
| Share target | An active human, guest or placeholder of this workspace. Refused: an agent (`forbidden`), a suspended or deleted member (`not_found`), the current owner (`forbidden`, "already owns this KPI") |
| Share level change | Sets the exact level. `edit` to `view` lowers. Owner binding untouched |
| Suspended member | Resolves to 0 everywhere (`reads.ts:68-72`, `accessScopeFilter` returns `false` at `reads.ts:398-402`). Bindings return on restore |
| Erased member | Owner and share bindings on `kpi` contexts soft-deleted inside the erase body, `packages/core/src/people/erase-member.ts` (KA-D13). `kpis.owner_member_id` keeps today's handling |
| Soft-deleted KPI | Every read filters `activeOnly(kpis, ...)`. `kpiContextResolver` and `requireKpiAccess` load the KPI row first, so a deleted KPI is not-found even though its context row stays |
| Archived or deleted space | No change. A KPI context does not depend on the space |
| Guest who creates a KPI | S-20's form names the person adding it as owner by default (UIUX-PLAN S-20), so they keep `full`. Through the API with no owner, a guest loses sight of it. Accepted |
| Support session | Capped by the shared functions as today (`reads.ts:160-166`) |

## 6. Every read path

"Filter" means: load the candidate KPI ids, keep `visibleKpiIds(...)`. "Single" means `requireKpiAccess(..., requires: view)` before anything is read.

| # | Path | File | Today | Change | Test |
|---|---|---|---|---|---|
| R1 | `kpis.grid` (S-20) | `actions/kpis.ts:732` | Every KPI (`:819-858`) | Filter. Categories shown only when they hold a visible KPI or the reader has role `kpi` at least `edit` | Guest with one share gets one row and its category only |
| R2 | `kpis.list` (pickers, copilot, webhooks) | `kpis.ts:946` | Every KPI | Filter | Guest with no share gets `[]` |
| R3 | `kpis.detail` (S-21) | `kpis.ts:2228` | No check | Single. `parent`, `children` and the formula `candidates` (`:2354-2411`) filtered. `linked` key results (`:2413-2425`) filtered by `visibleResourceIds` on `goal` | Guest without share gets not-found; with share sees only visible relatives |
| R4 | `kpis.tree` (S-18) | `kpis.ts:2040` | Every node | Filter. A visible node whose parent is hidden is drawn as a root with "Parent not visible" (Q3) | Tree with one shared node |
| R5 | `kpis.spaceTrees` (space home) | `kpis.ts:2130` | Space check at `:2157`, then every KPI of the space | Keep the space check, then filter | Guest in the space with no share sees an empty KPI section |
| R6 | `kpis.recoveryBoard` (S-19) | `kpis.ts:1709` | Every unhealthy KPI | Filter | Guest sees only shared unhealthy KPIs |
| R7 | `kpis.recoveryDraft` | `kpis.ts:2493` | No check | Single | Not-found for a hidden KPI |
| R8 | `kpis.narrateTrend` | `actions/rhythm-assists.ts:498` | Calls `readKpiDetail.handler` (`:523`) | Inherits R3 | Not-found before any model call |
| R9 | `kpis.suggest` | `actions/kpi-assist.ts:80` | Calls `readKpiGrid.handler` (`:106`) | Inherits R1; formula references only from visible KPIs | Suggestion never names a hidden KPI |
| R10 | Export of the KPI list | `exports/lists.ts:111-112` | `kpis.grid` | Inherits R1 | Guest export holds shared rows only |
| R11 | Search index | `search/subjects.ts:96, 224` | Context is the workspace's | `CONTEXT_FOR.kpi = "kpi"`; `contextResourceId: entityId`. Query side (`search/service.ts:77`) unchanged. 0037 re-points rows | Guest search finds a shared KPI only |
| R12 | Retrieval (copilot search, digest) | `embeddings/governing.ts:332-347` | Governed by the workspace | `{resourceType: "kpi", resourceId: entityId}` | Guest retrieval returns no hidden KPI passage |
| R13 | Copilot reads | `copilot/read-tools.ts:54-55, 1383`; `copilot/fast-path.ts:80` | `kpis.list`, `kpis.detail`; fast path follows the anchor read | Inherit R2, R3 | Copilot anchored on a hidden KPI reports it cannot read it |
| R14 | MCP `fetch` and `search` | `api/mcp/research.ts:137`; core toolset `api/mcp/toolset-data.ts:77-79` | `kpis.detail`, search service | Inherit R3, R11 | MCP fetch of a hidden KPI is not-found |
| R15 | Linking a key result to a KPI | `kpis/linked.ts:47`, called at `actions/goals.ts:2348` (`goals.addKeyResult`) and `:2935` (`goals.linkKpi`) | Existence check only | Add `memberId` to `readLinkableKpi` and call `requireKpiAccess` at view | Linking a hidden KPI is not-found |
| R16 | Goal page showing a linked KPI | `actions/goals.ts:154, 463` return `kpiId` only | The page names the KPI through `kpis.list` | The key result keeps its own value. The KPI chip shows "A KPI you cannot see" with no title or link (Q4) | Guest on a readable goal sees the value and the hidden chip |
| R17 | Webhook summary | `webhooks/deliver.ts:291-293` | `kpis.list` as the webhook owner | Inherits R2 | Owner without access gets `null` summary |
| R18 | KPI nudge recipients | `nudges/sweep.ts:100-125` | Every space member for a space-owned KPI | Keep only recipients for whom `visibleKpiIds` holds the KPI | Guest in the space receives no KPI nudge |
| R19 | Nudge text | `nudges/message.ts:93-103` | Renders the title | No change once R18 filters | Covered by R18 |
| R20 | Notifications and the mailed digest | `notifications/visibility.ts:37`, `notifications/digest.ts:139, 272` | `hasSubjectResolver("kpi")` is false, so every KPI notification passes | Starts checking once the resolver exists. No code change | Notification about a hidden KPI is not listed |
| R21 | Proposals and the review inbox | `review/proposals.ts:148`; `actions/review.ts:723-740` | KPI proposals skip the reach check | Reach check at `edit` applies once the resolver exists | KPI proposal not shown to a recipient without edit |
| R22 | Feed | `activities/feed.ts:150-159`; `kpis.ts:493-502` | KPI activities have a null context and are workspace-public | `kpi.created` sets `activity.contextId` to the new KPI context (`operation.ts:784-786` honours it). Other KPI activities get it from the resolver. 0037 re-points old rows | Guest feed shows no hidden KPI activity |
| R23 | Space creation access | `actions/spaces.ts:364-386` | `canCreateKpi` from the role | No change | None |
| R24 | Built-in agents | `agents/scope.ts:103-108` | KPI or space binding | No change (KA-D9) | Agent unbound from a space no longer sees its KPIs |
| R25 | Comment on `reads.ts:798-803` | Lists KPI among types with no resolver | Text updated | None |

## 7. Actions

### 7.1 Existing KPI actions

"Subject" means `subject: {type: "kpi", id: input.kpiId}` on the Operation spec. "In handler" is the check inside `execute` or the read handler; the floor is only a floor (`operation.ts:191-223`).

| Action | File:line | Kind | Level today | Domain | Agent surface (toolset) | Change |
|---|---|---|---|---|---|---|
| `kpis.createCategory` | `kpis.ts:324` | write | edit | kpi | yes (work) | None |
| `kpis.create` | `kpis.ts:374` | write | edit | kpi | yes (work) | `ensureKpiContextInTx` for every KPI; activity `contextId` (R22) |
| `kpis.record` | `kpis.ts:514` | write | edit | kpi | yes (core) | Subject. In handler `requireKpiAccess` edit. A share at `edit` reaches it |
| `kpis.deleteRecord` | `kpis.ts:646` | destructive | edit | kpi | no | No subject. In handler `requireKpiAccess` view, then `requireKpiRole` edit |
| `kpis.grid` | `kpis.ts:732` | read | view | none | yes (work) | R1 |
| `kpis.list` | `kpis.ts:946` | read | view | none | yes (core) | R2 |
| `kpis.setFormula` | `kpis.ts:1007` | write | edit | kpi | yes (work) | Subject. `requireKpiAccess` edit on the KPI and view on every referenced KPI |
| `kpis.update` | `kpis.ts:1125` | write | edit | kpi | yes (work) | Subject. `requires: full` when `ownerMemberId` is given, else edit. In handler the same level; owner rebind; `requireKpiAccess` view on a new `parentKpiId` |
| `kpis.createTree` | `kpis.ts:1383` | write | edit | kpi | yes (work) | `requireKpiRole` edit; `requireKpiAccess` view on `rootKpiId` when given |
| `kpis.launchRecovery` | `kpis.ts:1439` | write | edit | kpi | yes (work) | `requireKpiAccess` view, `requireKpiRole` edit |
| `kpis.recordResponse` | `kpis.ts:1527` | write | edit | kpi | yes (work) | `requireKpiAccess` view, `requireKpiRole` edit |
| `kpis.recoveryBoard` | `kpis.ts:1709` | read | view | none | yes (work) | R6 |
| `kpis.tree` | `kpis.ts:2040` | read | view | none | yes (work) | R4 |
| `kpis.spaceTrees` | `kpis.ts:2130` | read | view | none | yes (work) | R5 |
| `kpis.detail` | `kpis.ts:2228` | read | view | none | yes (core) | R3 |
| `kpis.recoveryDraft` | `kpis.ts:2493` | read | view | none | yes (work) | R7 |
| `kpis.narrateTrend` | `rhythm-assists.ts:498` | read | view | none | no | R8 |
| `kpis.suggest` | `kpi-assist.ts:80` | read | edit | none | no | R9 |

### 7.2 New actions

All four in `packages/core/src/actions/kpis.ts`, registered in `registry.ts`.

| Action | Kind | Input (Zod) | Output | Level, domain, subject | Agent surface |
|---|---|---|---|---|---|
| `kpis.share` | write | `{kpiId: z.uuid(), memberId: z.uuid(), level: z.enum(["view", "edit"])}` | `{kpiId, memberId, level, previousLevel: "view" \| "edit" \| null, coveredByRole: boolean}` | `full`, `kpi`, subject | false |
| `kpis.unshare` | write | `{kpiId: z.uuid(), memberId: z.uuid()}` | `{kpiId, memberId, removed: boolean}` | `full`, `kpi`, subject | false |
| `kpis.shares` | read | `{kpiId: z.uuid()}` | `{owner: {memberId, name, kind} \| null, shares: Array<{memberId, name, kind: "human" \| "guest" \| "placeholder", status, level: "view" \| "edit", sharedAt: string, roleLevel: number \| null}>}` | `view` (G4-Q3, Q6), handler `requireKpiAccess` view | yes, `work` |
| `kpis.importShare` | write | `{kpiId: z.uuid(), memberId: z.uuid(), level: z.enum(["view", "edit"]), legacy: legacyKey}` (`packages/core/src/imports/legacy.ts:32`) | `{outcome: "written" \| "raised" \| "unchanged" \| "revoked", coveredByRole: boolean}` | `full`, `kpi`, no subject (the floor is the role, as for `people.importMember`) | false |

Handler steps:

| Action | Steps |
|---|---|
| `kpis.share` | Acting member. `ensureKpiContextInTx`. `requireKpiAccess` full. Load target, apply §5 refusals. `setKpiShareInTx`. `coveredByRole` = target's role level on `kpi` already at least `level`. Activity `kpi.shared` on subject `kpi`. Audit below |
| `kpis.unshare` | Acting member. `requireKpiAccess` full. `removeKpiShareInTx`. Removing a share that does not exist returns `removed: false` and still writes the activity and audit row, so a double click is harmless. Activity `kpi.unshared` |
| `kpis.shares` | `requireKpiAccess` view. Read live `owner` and `share` bindings on the KPI context with their members. No grantor field: `access_bindings` has none; the audit trail has it |
| `kpis.importShare` | Acting member (the `--as` human). `ensureKpiContextInTx`. Ledger (§8.3). Refusals as `kpis.share`. Owner target gives `unchanged`. Activity `kpi.shared` with `imported: true`; the importer's bulk context suppresses notification dispatch (`define.ts:469`) |

Contract and process for the slices that touch the registry:

- New activity kinds `kpi.shared` and `kpi.unshared` with payload schemas in `packages/core/src/activities/catalogue.ts`, and feed lines in both catalogues.
- `kpis.shares` added to `TOOLSETS.work` in `packages/core/src/api/mcp/toolset-data.ts`, or the placement test fails.
- `pnpm gen:contract` regenerates `contract/openapi.json`, `contract/cli.json` and `contract/mcp.json` (only `kpis.shares` reaches it); `pnpm gen:docs` regenerates `docs/api/reference.md`.
- Catalogue keys in `packages/ui/src/i18n/messages/en.json` and `ms.json`. The 0.10.0 locales pick them up through L5 to L10 (release plan §8 step 3).
- A changeset per slice that changes a running instance (§13).

## 8. Import

### 8.1 Domain

New `--only` domain `kpi-shares`, summary "KPI shares from indicator_accesses", `requires: ["kpis"]`, appended to `DOMAINS` in `packages/importer/src/flowyteam/domains.ts` after `kpis`. Mapper `packages/importer/src/flowyteam/mappers/kpi-shares.ts`. A full run includes it. The CLAUDE.md `import:flowyteam` entry lists the new domain.

### 8.2 Row rules

Source rows: `indicator_accesses` joined to `indicators` of the run's company, both with `deleted_at is null`. Read-only, through the existing `Source`.

Source key: `legacyKeyFor("indicator_accesses", row.id)` when the table has an `id` column. The reference does not list one, so `introspect.ts` checks first; without it the key is `<indicator_id>:<user_id>`.

| Source row | Result | Report line |
|---|---|---|
| `permissions = read`, user resolves | Share at `view` | Counted under written / raised / unchanged |
| `permissions = update`, user resolves | Share at `edit` | Same |
| User resolves to a placeholder | Share written (KA-D14) | Counted, and "takes effect when claimed" total |
| Target's current role already grants the level | Share written | "Covered by current role" (information) |
| Target is the KPI owner | Nothing | Unchanged, "owner" |
| Indicator not imported (deleted, other company, `kpis` domain skipped in a dry run) | Nothing | "KPI not imported", per row |
| User not imported | Nothing | "Person not imported", per row |
| `user_id` null, `department_id` set (team share) | Nothing | "Team share not carried over", with the team's imported space name when known |
| `user_id` and `department_id` both set | User share written | "Department ignored" |
| `view_options` of any value | No effect | Count per value, and each non-`everyone` row listed (KPI, person, value) |
| `occurance` of any value | No effect | Count per value. OpenOKR has no per-person view frequency |
| Ledger says revoked (§8.3) | Nothing | "Revoked after an earlier import, left revoked" |

### 8.3 Idempotency ledger

Inside `kpis.importShare`, on the Operation's transaction, read `audit_events` by `(workspace_id, target_type = 'kpi', target_id = kpiId)` (index `audit_events_target_idx`, `packages/db/migrations/0006_audit_and_activity.sql:94`) with `action = 'kpis.importShare'` and `payload->>'legacyId' = legacy.id`.

| Ledger | Live `share` binding | Outcome |
|---|---|---|
| No row | None | `written` |
| No row | Lower level (a manual share) | `raised` |
| No row | Same or higher | `unchanged` |
| Row found | Present | `unchanged` (a person may have changed the level since; it stands) |
| Row found | Absent | `revoked`, nothing written |

Every outcome writes its audit row with `legacyType`, `legacyId` and `outcome`, so the second run reads the first run's rows.

### 8.4 Restriction detection

The reference names no visibility flag on `indicators`. The rule uses what the source holds: **an indicator is flagged when it has at least one live `indicator_accesses` row.** A per-person grant exists only to give somebody access, which suggests the source limited who saw the KPI. In OpenOKR every human member reads every KPI (KA-D2), so each flagged KPI may become more visible.

The flag list prints per KPI: title, source id, the number of named people, and the number of active human members who will read it. Q7 asks whether `--write` refuses while flagged KPIs exist, and Q8 whether the rule needs checking against FlowyTeam's code.

### 8.5 Dry run

Same path, `--write` absent, as every domain today. Output block "KPI shares":

```
KPI shares (indicator_accesses)
  Rows read                         50
  Would write at view               24
  Would write at edit               19
  Would raise a manual share         0
  Unchanged (owner or same level)    2
  Covered by current role (info)    20
  Takes effect when claimed (info)  18
  Revoked after an earlier import    0
  KPI not imported                   1
  Person not imported                2
  Team share not carried over        2
  View options: me 4, manager 3, team 2, everyone 41
  View frequencies: daily 12, weekly 30, monthly 8
  KPIs that may become more visible: 9 (listed below)
```

## 9. Audit and notifications

| Event | Audit `action` | `targetType` / `targetId` | Payload | Actor |
|---|---|---|---|---|
| Share | `kpis.share` | `kpi` / KPI id | `{memberId, level, previousLevel}` | The member who shared |
| Unshare | `kpis.unshare` | `kpi` / KPI id | `{memberId, previousLevel}` | The member who removed it |
| Import | `kpis.importShare` | `kpi` / KPI id | `{memberId, level, legacyType, legacyId, outcome, coveredByRole}` | The `--as` human. No `grantedBy` field: it would repeat the actor |
| Owner change | `kpis.update` (existing) | `kpi` / KPI id | `fields` includes `ownerMemberId` (existing) | The member who changed it |
| Data change 0037 | none | | | Accepted: a data change has no actor (§3.3) |

Notification to the grantee: none in 0.10.0. A new notification is a new proactive message kind, which needs a rule key, a nudge row, deduplication and Akmal's approval (CLAUDE.md). Q5.

## 10. Screens

| Screen | Route | Change | Loading | Empty | Error | Permission denied |
|---|---|---|---|---|---|---|
| S-21 KPI detail | `apps/web/app/kpis/[id]/page.tsx` | New "Shared with" card under "How it is judged": owner line, then shares with level. With `full`: Share opens a side panel with the member picker the owner field uses and a View / Edit `SelectInput`; each row has a level select and Remove with a confirm. Hint "Already has edit through their role" when `roleLevel` covers it. Owner field disabled without `full`, with the reason | Card skeleton | "Not shared with anyone. Members read it through their role." | Card with the error text and Retry; the page stays usable | Without `full`: read-only list, no controls. Without `view`: the existing not-found page |
| S-20 KPI grid | `apps/web/app/kpis/page.tsx` | Rows from R1. New KPI and New category hidden when the role on `kpi` is below `edit` | Existing `loading.tsx` | Guest with nothing shared: "No KPIs have been shared with you." | Existing `error.tsx` | Not applicable; the list is the reader's own |
| S-18 KPI trees | `apps/web/app/kpis/trees/page.tsx` | Nodes from R4, "Parent not visible" on an orphan | Existing | "No KPIs in this tree that you can see." | Existing | Add driver hidden without role `edit` |
| S-19 Recovery board | `apps/web/app/kpis/recovery/page.tsx` | Cards from R6 | Existing | Existing "all KPIs healthy" | Existing | Responses hidden without role `edit` (KA-D17) |
| Space home KPI section | `apps/web/app/spaces/[id]` | Rows from R5 | Existing skeleton | "No KPIs here that you can see." | Existing error card | As S-18 |
| Goal page KR chip | `apps/web/app/goals` | R16 chip | Existing | Not applicable | Existing | Hidden chip, no link |

No change to `/admin/imports` (the CSV wizard). It imports no shares. UIUX-PLAN §9 quality gates apply to every row, and `e2e/s43-accessibility.spec.ts` scans the changed screens on its own.

## 11. Open questions for Akmal

| # | Question | Recommendation | Possible answers |
|---|---|---|---|
| Q1 | Share authority and owner change are "`full` on the KPI: the owner binding, or a role granting manage on `kpi`". You approved "owner, Owner or Admin". The two differ when an admin lowers the Admin role's KPI permission or gives manage to a custom role. Changing the owner also needs this level, so a Member who does not own a KPI can no longer reassign it | Accept | Accept / Restrict |
| Q2a | Should a guest invited to a space see that space's KPIs? Goals give a space guest nothing today (`spaces/service.ts:358-384`) | No. A guest sees only KPIs shared with them | No / Yes |
| Q2b | Should a space KPI bind `space_standard` at `edit`, as goals do, so a Viewer in the space can record readings? | No. Keep today's role behaviour | No / Yes |
| Q3 | Does a share on a parent KPI cover its children? What does a reader see of a calculated KPI whose sources they cannot see? | No cascade. The calculated KPI shows its own value; hidden sources appear as "A KPI you cannot see" with no title or values; a hidden parent shows "Parent not visible" | Accept / Cascade |
| Q4 | A goal everyone reads has a key result that follows a KPI a guest cannot see. What does the guest see? | The key result's value (it belongs to the key result). The KPI's title and link are hidden | Accept / Hide |
| Q5 | Should `kpis.share` notify the grantee? It is a new message kind | No notification in 0.10.0 | None / Notify |
| Q6 | G4-Q3: who may read `kpis.shares`? At `view`, a guest with one share can list the names of everyone else it is shared with | `view`, as recommended in the release plan, with this point noted | View / Full |
| Q7 | When the dry run flags KPIs that may become more visible, should `--write` refuse unless `--accept-broader-visibility` is given? The check runs before any write, only when the run includes `kpis` or `kpi-shares` | Refuse. The operator reads the list once and says so | Refuse / Report |
| Q8 | The flag rule is "any `indicator_accesses` row". FlowyTeam's own visibility logic is not in the reference. Check it against FlowyTeam's code before release? | Verify, as a task in the import slice | Accept / Verify |

## 12. Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Member who owns KPI-A, created after this release | They open S-21 | Share is offered. `kpis.share` succeeds; their level on KPI-A resolves to 100 |
| AC-2 | A Member who does not own KPI-A and holds edit on it | They call `kpis.update` with `ownerMemberId` set to themselves | Refused with `forbidden`; the owner is unchanged |
| AC-3 | A Viewer holding an `edit` share on KPI-A | They call `kpis.update` with `ownerMemberId` | Refused; changing the owner needs `full` |
| AC-4 | An admin set the Admin role's `kpi` permission to `edit` | An Admin who does not own KPI-A calls `kpis.share` | Refused. An Owner-role member succeeds |
| AC-5 | KPI-A owned by Ana, shared with Ben at `edit` | Ana calls `kpis.unshare` for Ben | Ben's `share` binding is soft-deleted; Ana's `owner` binding is untouched |
| AC-6 | Ben holds a `share` at `edit` on KPI-A | The owner calls `kpis.share` for Ben at `view` | Ben's binding level is 10; Ben's `kpis.record` on KPI-A is refused |
| AC-7 | Ana owns KPI-A | Somebody calls `kpis.share` with Ana as target | Refused, "already owns this KPI"; no binding written |
| AC-8 | An agent member | The owner calls `kpis.share` with the agent as target | Refused with `forbidden` |
| AC-9 | A Viewer with an `edit` share on KPI-A | They record a reading on KPI-A, then on KPI-B with no share | KPI-A succeeds; KPI-B is refused |
| AC-10 | A Viewer with an `edit` share on KPI-A | They call `kpis.deleteRecord` or `kpis.launchRecovery` on KPI-A | Refused; these need the role (KA-D17) |
| AC-11 | A guest with a `view` share on KPI-B only | They call `kpis.grid` and `kpis.list` | Each returns KPI-B only |
| AC-12 | Same guest | They call `kpis.detail` on KPI-C | `not_found` |
| AC-13 | Same guest | They search for KPI-C's title in the app and through MCP `search` | No result |
| AC-14 | Same guest | They ask the copilot about KPI-C, and use MCP `fetch` on its address | The copilot cannot read it; `fetch` is not-found |
| AC-15 | Same guest | They export the KPI list | The file holds KPI-B only |
| AC-16 | Same guest | They open S-18 and S-19 | Only KPI-B appears; a hidden parent shows "Parent not visible" |
| AC-17 | Same guest, a member of space S holding KPI-C | They open S's home | The KPI section is empty |
| AC-18 | Same guest, recipient of a webhook | An event on KPI-C is delivered | The summary is `null` |
| AC-19 | Same guest, in space S that owns KPI-C | KPI-C turns unhealthy and the sweep runs | No nudge reaches the guest; other space members still get it |
| AC-20 | Same guest | They call `goals.linkKpi` with KPI-C | `not_found` |
| AC-21 | Same guest | They read the feed after KPI-C changed | No line about KPI-C |
| AC-22 | A Viewer with no share | They open S-20 | Every KPI is listed, as today |
| AC-23 | A custom role with `kpi` at 0 | Its holder opens S-20, then records on any KPI | Every KPI is listed; recording is refused |
| AC-24 | A space KPI created by an old pod with no context (a straggler) | A Member opens it, a Viewer tries to record on it, a guest searches for it | The Member reads it; the Viewer is refused; the guest finds it only if they hold a binding on the workspace context |
| AC-25 | 0037 has not run | Any human member opens S-20 | Every KPI is listed, as before the upgrade |
| AC-26 | 0037 ran once | It runs again | 0 rows changed |
| AC-27 | A workspace before 0037 with a space KPI and a spaceless KPI | 0037 runs | Both have a `kpi` context with `workspace_standard` at 10 and the owner at 100 tagged `owner`; no new agent binding exists; their search rows and KPI activities point at the new contexts |
| AC-28 | An agent bound to space S only, then unbound | The Champion's sweep reads KPIs | KPIs of S are out of its sight |
| AC-29 | Ben holds a share and is suspended | Ben's token calls `kpis.detail` on the shared KPI | `not_found`. After `people.restore` the share works again |
| AC-30 | Ben holds a share and owns KPI-D | `people.erase` runs for Ben | Ben's `share` and `owner` bindings on KPI contexts are soft-deleted |
| AC-31 | A soft-deleted KPI with a live context | Its former owner calls `kpis.detail` | `not_found` |
| AC-32 | A FlowyTeam source with 50 access rows: 20 targets whose role covers the level, 15 Viewers with `update`, 8 guests with `read`, 5 placeholders, 2 team shares | A dry run | Report shows 48 shares that would be written, 20 marked covered by role, 5 marked takes effect when claimed, 2 team shares not carried over, and per-value counts of view options and frequencies |
| AC-33 | The same source after a `--write` run | A second `--write` run | 0 bindings written; every row reported unchanged |
| AC-34 | An imported share that an admin removed with `kpis.unshare` | The import runs again | The share is not written; the report lists it as revoked after an earlier import |
| AC-35 | An indicator with two `indicator_accesses` rows | A dry run | The KPI is in the "may become more visible" list with 2 named people and the count of human members |
| AC-36 | A placeholder holding an imported share | The person signs up with the placeholder's address | They read the KPI at the imported level |
| AC-37 | `--only kpi-shares` | A run with nothing else named | The report says `kpis` and `organisation` were added first |
| AC-38 | A guest with one share and Q6 answered "View" | They call `kpis.shares` | They see the owner and every grantee; a guest with no share is not-found |
| AC-39 | The AI provider is off | Any of the above | Every result is the same; no screen in this design needs AI |

## 13. Build split

Each slice is one commit on its own branch from `main`, signed off, with a changeset where it says so. The local tier of CLAUDE.md runs per slice; the full suites are CI's. Order matters: each slice assumes the ones above it.

| Slice | Delivers | Tests | Changeset |
|---|---|---|---|
| K1 Tags | Migration 0172; Drizzle enum; DATABASE.md and TECHNICAL-PLAN §4 rows of §3.4 for tags and `kpi_shares` (KA-D8); portability policy and people export notes | `pnpm --filter @openokr/db test`: a binding with tag `owner` and `share` inserts, an unknown tag is refused; `pnpm db:lint` | patch |
| K2 Context and owner | `packages/core/src/kpis/access.ts` with `ensureKpiContextInTx`, `rebindKpiOwnerInTx`; `kpiContextResolver` in `SUBJECT_RESOLVERS`; `kpis.create` uses it for every KPI; `kpis.update` owner change at `full` with subject; R11, R12, R22, R25 | Unit: create binds standard, owner and (spaceless only) agents; AC-2, AC-3; resolver returns the workspace context for a straggler and `undefined` for a deleted KPI | minor |
| K3 Data change 0037 | Script, registry entry, §3.3 steps | `packages/db` suite: AC-26, AC-27 | patch |
| K4 Read enforcement | `requireKpiAccess`, `visibleKpiIds`; R1 to R10, R13 to R21, R23, R24; screen empty states of §10 for S-20, S-18, S-19 and the space home | Unit per path: AC-11, AC-12, AC-15 to AC-25, AC-28, AC-31; straggler rule test of §5. E2E: one guest spec covering AC-11 and AC-17 | minor |
| K5 Write enforcement | Subject and in-handler checks of §7.1 table; `requireKpiRole` | AC-9, AC-10, AC-23 | minor |
| K6 Sharing actions | `kpis.share`, `kpis.unshare`, `kpis.shares`; activity kinds; toolset placement; erasure removal (KA-D13); `pnpm gen:contract`, `pnpm gen:docs` | AC-1, AC-4 to AC-8, AC-29, AC-30, AC-38; `pnpm check:contract` | minor |
| K7 S-21 sharing card | §10 S-21 row; goal chip R16; catalogue keys in `en.json` and `ms.json` | Component tests for the four states; E2E: owner shares with a Viewer at edit and the Viewer records (AC-9 through the browser) | minor |
| K8 Import | `kpis.importShare`; `kpi-shares` domain and mapper; ledger; restriction list; Q7 flag if answered Refuse; `unread.ts`; TECHNICAL-PLAN §7.2 rows; CLAUDE.md importer entry | Importer suites with MySQL (`TEST_MYSQL_PORT`): AC-32 to AC-37 | minor |

After the release (0.11.0, not part of these cards): data change 0038 named by a migration, removal of the straggler branches, `kpi_shares` dropped (§4).

Review findings resolved differently from the review's suggestion: nit 16 (a custom role at 0 is not narrowed, KA-D2) and finding 5 (the fallback is not switched by the ledger, §4). Both say why above.
