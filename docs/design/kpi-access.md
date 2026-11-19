# Access to one KPI, and FlowyTeam's KPI shares

Status: **ready for design approved, 19 November 2026**.
Akmal and Agung on 19 November 2026: approved planning directions G4-Q1 and G4-Q2 in [release 0.10.0 plan](../plans/release-0.10.0.md) §7. Grant authority is the KPI's owner, a workspace Owner, or an Admin. Build access per KPI in 0.10.0 before importing FlowyTeam's KPI shares. Imports carry additive grants (`read` to `view`, `update` to `edit`), report unmapped FlowyTeam restrictions, view options and frequencies per row, and flag broader visibility for human review before import. This document details the implementation design and awaits explicit "design approved" before code (CLAUDE.md).

## 1. Context and current state

| Fact | Where |
|---|---|
| A human's access to a KPI is currently determined solely by their workspace role on the `kpi` domain: Owner and Admin `full` (100), Member `edit` (70), Viewer `view` (10). No KPI action names an individual KPI as its subject | `packages/core/src/access/roles.ts`, `packages/core/src/actions/kpis.ts` |
| The access getter resolves `workspace`, `space`, `goal`, `initiative`, and `task` to their own access context. `kpi` is not among them | `SUBJECT_RESOLVERS`, `packages/core/src/access/reads.ts:479` |
| A KPI with no space currently gets an `access_contexts` row at creation only so the Coach and Champion built-in agents can be bound to it. A KPI in a space has no context of its own | `packages/core/src/actions/kpis.ts:483`, `packages/core/src/agents/scope.ts` (`agentSeesKpi`) |
| An access binding can only raise access: workspace role and resource bindings compose by taking the maximum, and there is no deny rule | CLAUDE.md ("Object authorisation"), `packages/core/src/access/reads.ts` (`can`) |
| FlowyTeam models `indicator_accesses`: per indicator, a user, `read` or `update`, a view option, and a view frequency | `docs/specification/reference/flowyteam-okr-kpi-tasks-model.md` §4.4 |
| FlowyTeam importer lists `indicator_accesses` as unread and reports its row counts | `packages/importer/src/flowyteam/unread.ts`, `docs/specification/TECHNICAL-PLAN.md` §7.2 |
| Legacy table `kpi_shares` was created in migration `0026_kpis.sql` but is completely unread and unwritten | `packages/db/migrations/0026_kpis.sql`, `packages/db/src/schema/kpis.ts` |

### Implications for FlowyTeam share import
Because access bindings compose additively by maximum (`max(role, binding)`) and never lower access:
- Per-KPI bindings only raise access for members whose role grants less than the share:
  - A **Viewer** (role level `view` / 10) with an imported `update` share gains `edit` (70) on that specific KPI.
  - A **guest** (no workspace role) with a `read` or `update` share gains `view` (10) or `edit` (70) on that specific KPI.
- A **Member** already holds `edit` (70) on all workspace KPIs by role; an imported `read` or `update` share adds no privilege. The importer must count such rows as "covered by role" without inserting redundant bindings.
- FlowyTeam's privacy restriction (an indicator configured so *only* designated shared users can see it) cannot be reproduced in OpenOKR's access model without a deny rule. In OpenOKR, workspace Members will be able to see the KPI. The importer must detect these restrictions and flag them in the pre-import report for human review before importing.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| KA-D1 | **Every KPI owns a `kpi` context.** Every new KPI gets an `access_contexts` row at creation regardless of whether it is in a space or spaceless. Data change `0037_backfill_kpi_contexts.ts` gives every existing KPI without a context its own row (batched, idempotent by ledger, binding Coach and Champion agents). | Consistent resolution. Eliminates special cases for KPIs in spaces vs spaceless KPIs. |
| KA-D2 | **`kpi: ownContextResolver("kpi")` joins `SUBJECT_RESOLVERS`.** The KPI context sits under its owner's context (the space context if in a space, or the workspace context if spaceless), preserving space-level binding cascades to space KPIs. | Follows the exact pattern of initiatives and tasks (`packages/core/src/access/reads.ts`). |
| KA-D3 | **Single-KPI reads and writes name `{ type: "kpi", id: input.kpiId }` as their subject.** The floor is `max(role.kpi, bindings)`. KPI list actions evaluate `visibleResourceIds("kpi")`: Members/Admins see all; Viewers and guests see KPIs where role, space binding, or KPI binding grants `view`. | Satisfies the CLAUDE.md mandate: role and bindings through one `can()`. |
| KA-D4 | **Additive permissions only.** Roles grant what they grant. A per-KPI binding only elevates access. No deny rules exist. | Architecture principle: zero negative permissions. |
| KA-D5 | **Audited sharing actions and authority.** Actions `kpis.share` and `kpis.unshare` require `full` (level 90) on the KPI. This authority is held by the KPI's owner (`ownerMemberId`), a workspace Owner, or an Admin. | Settled by Akmal on 19 November 2026 (G4-Q1). Prevents unauthorized access elevation. |
| KA-D6 | **FlowyTeam share import mapping.** `indicator_accesses` rows import via `kpis.importShare`: `read` maps to `view` (10) and `update` maps to `edit` (70). Skips placeholder members. Rows covered by target roles are counted as "covered by role" and not written. Unmappable view options and frequencies are counted and listed per row. Source visibility restrictions are flagged for human review. | Settled by Akmal on 19 November 2026 (G4-Q2). Accurate, transparent import reporting. |
| KA-D7 | **`kpi_shares` table remains unused.** Marked as "no legacy source" in `TECHNICAL-PLAN.md` §7.2. Left for a later release to drop under the two-release rule (PLAN.md §5.1, CLAUDE.md). All sharing uses standard `access_contexts` and `access_bindings`. | Prevents duplicate, competing storage for access grants. |
| KA-D8 | **Agent visibility preserved.** `agentSeesKpi` in `packages/core/src/agents/scope.ts` continues reading `kpi` and `space` bindings on the KPI's context. | Built-in Coach and Champion agents retain proper KPI visibility. |

## 3. Schema change and migration

### Row-level security (RLS) and business tables
Per CLAUDE.md:
> Every business table gets `workspace_id` and a row-level security policy in the same migration. The tenant setting is applied with `SET LOCAL` per transaction. Row-level security is the tenant floor; it does not replace object authorisation.

KPI access uses the existing relationship access model tables:
- `access_contexts`: has `workspace_id`, `force row level security`, and policy `tenant_isolation` (migration `0009_access_model.sql`).
- `access_bindings`: has `workspace_id`, `force row level security`, and policy `tenant_isolation` (migration `0009_access_model.sql`).
- `access_groups`: has `workspace_id`, `force row level security`, and policy `tenant_isolation` (migration `0009_access_model.sql`).

**No new DDL table is created for 0.10.0.**
The existing `kpi_shares` table (from migration `0026_kpis.sql`) already has `workspace_id` and `tenant_isolation` RLS, but will not be used; all per-KPI grants are stored as `access_bindings` referencing the KPI's `access_contexts` row.

### Data migration (Data change)
- **Script**: `packages/db/src/data-changes/0037_backfill_kpi_contexts.ts`.
- **Function**:
  1. Finds all existing `kpis` that do not have an `access_contexts` row with `resource_type = 'kpi'` and `resource_id = kpis.id`.
  2. Creates the missing `access_contexts` row with `workspace_id = kpis.workspace_id`.
  3. Binds Coach and Champion agents to the newly created context via `bindAgentsToContextInTx`.
  4. Runs in batches of 100 with ledger tracking for idempotency and zero-downtime execution.

## 4. TECHNICAL-PLAN §7.2 importer mapping updates

The following rows in `docs/specification/TECHNICAL-PLAN.md` §7.2 are updated:

| Source / Target | Source table / concept | OpenOKR target / status | Update in 0.10.0 |
|---|---|---|---|
| `kpi_shares` (line 503) | `kpi_shares` | Not read, no legacy source | Update entry: `kpi_shares` is marked "no legacy source", unread, and scheduled for removal under the two-release rule. Sharing is implemented via `access_contexts` and `access_bindings`. |
| `indicator_accesses` (line 529) | `indicator_accesses` | Not imported yet, reported | Change status to **Imported via `kpis.importShare`**. Each row maps `read` to `view` (level 10) and `update` to `edit` (level 70) on the KPI's context. Rows covered by target roles are recorded as "covered by role". Unmapped view options and view frequencies are reported per row. Indicators with source visibility restrictions are flagged for human review before import. |
| `access_contexts`, `access_bindings` (line 542) | `access_contexts`, `access_bindings` | Relationship access model | Update notes: `indicator_accesses` creates `access_bindings` on the imported KPI's own context for non-redundant grants. |

## 5. Access getter and `can()` changes

In `packages/core/src/access/reads.ts`:

1. **`SUBJECT_RESOLVERS`**:
   Add `kpi` entry:
   ```ts
   kpi: ownContextResolver("kpi"),
   ```
   When a caller checks access with `subject: { type: "kpi", id: kpiId }`, `resolveContext` loads the KPI's `access_contexts` record.

2. **`visibleResourceIds`**:
   Add support for `resourceType: "kpi"`:
   ```ts
   case "kpi": {
     // If member's workspace role has >= view (10) on 'kpi' domain,
     // return null (all workspace KPIs are visible).
     if (roleLevel >= ACCESS_LEVELS.view) return null;
     // Otherwise (Viewer without domain view, or guest), find IDs from
     // active access_bindings on KPI contexts, plus space bindings that cascade.
     return await resolveBoundResourceIds(tx, workspaceId, memberId, "kpi");
   }
   ```

3. **`can()` integration**:
   `can(actor, "kpis.read", { type: "kpi", id: kpiId })` computes `max(workspaceRoleLevel, bindingLevel)`. If this maximum meets or exceeds the action's required level, permission is granted.

## 6. Contract actions and required levels

In `packages/core/src/actions/kpis.ts`:

### New sharing actions
- **`kpis.share`**:
  - **Input**: `{ kpiId: string, memberId: string, level: "view" | "edit" }`
  - **Required level**: `full` (90) on `subject: { type: "kpi", id: input.kpiId }`.
  - **Behavior**: Finds or creates the member's personal `access_groups` row; inserts or updates `access_bindings` on the KPI's context with level 10 (`view`) or 70 (`edit`).
  - **Audited**: Yes.

- **`kpis.unshare`**:
  - **Input**: `{ kpiId: string, memberId: string }`
  - **Required level**: `full` (90) on `subject: { type: "kpi", id: input.kpiId }`.
  - **Behavior**: Soft-deletes the `access_bindings` row for the member on the KPI's context.
  - **Audited**: Yes.

- **`kpis.shares`**:
  - **Input**: `{ kpiId: string }`
  - **Required level**: `view` (10) on `subject: { type: "kpi", id: input.kpiId }`.
  - **Behavior**: Returns list of members with active bindings on this KPI, their level (`view` or `edit`), grantor ID, and created timestamp.

- **`kpis.importShare`** (Internal import action):
  - **Input**: `{ kpiId: string, memberId: string, level: "view" | "edit", sourceAccessId?: string }`
  - **Required level**: Internal migrator privilege (`system` / `importWorker`).
  - **Behavior**: Skips placeholder members. Checks target role level; if already covered, increments `coveredByRoleCount` and skips insert. Otherwise writes binding.

### Updated single-KPI actions
All single-KPI actions pass `subject: { type: "kpi", id: input.kpiId }`:
- `kpis.get` / `kpis.detail`: required level `view` (10).
- `kpis.records` (list readings for a KPI): required level `view` (10).
- `kpis.record` (record reading value): required level `edit` (70).
- `kpis.update` (edit metadata, target, formula): required level `edit` (70).
- `kpis.setFormula`: required level `edit` (70).
- `kpis.delete`: required level `full` (90).

Workspace-wide list `kpis.list`:
- Continues checking role level; uses `visibleResourceIds("kpi")` to filter accessible KPIs.

## 7. Screens touched

1. **Screen S-24 (`/kpis/[id]`)**:
   - Add "Access & Sharing" section or modal tab.
   - If user holds `full` access on the KPI (KPI owner, workspace Admin, or Owner):
     - Displays "Share KPI" button.
     - Member selection autocomplete with role selector (`Viewer` or `Editor`).
     - List of shared members with "Remove" action.
   - If user holds `view` or `edit`:
     - Displays read-only list of who has explicit shares on this KPI.

2. **Screen S-23 (`/kpis` list view)**:
   - Query applies `visibleResourceIds("kpi")`. Viewers and guests only see KPIs they are explicitly granted access to.

3. **Screen `/admin/import` (FlowyTeam importer)**:
   - Dry-run and execution summary cards report:
     - Total `indicator_accesses` scanned.
     - Explicit bindings created (broken down by `view` and `edit`).
     - Shares skipped as already covered by workspace role.
     - Shares skipped due to unmapped/placeholder members.
     - List of KPIs flagged with source visibility restrictions (where OpenOKR role visibility is broader than FlowyTeam's).
     - Itemised table of unmapped view options and view frequencies.

## 8. Audit rows

All KPI sharing operations write immutable audit rows:
- **`kpis.share`**:
  - `targetType`: `"kpi"`
  - `targetId`: `kpiId`
  - `payload`: `{ memberId: string, level: "view" | "edit", grantedBy: string }`
  - `actorId`: Actor's member ID.
- **`kpis.unshare`**:
  - `targetType`: `"kpi"`
  - `targetId`: `kpiId`
  - `payload`: `{ memberId: string, revokedBy: string }`
  - `actorId`: Actor's member ID.
- **`kpis.importShare`**:
  - `targetType`: `"kpi"`
  - `targetId`: `kpiId`
  - `payload`: `{ memberId: string, level: "view" | "edit", sourceAccessId: string, importRunId: string }`
  - `actorId`: Migrator system actor ID.

## 9. Acceptance criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Viewer with an `update` share imported from FlowyTeam on KPI-A | The Viewer opens KPI-A | They can record reading values on KPI-A (`kpis.record`); on any other KPI without a share they cannot edit or record values. |
| AC-2 | A guest with a `read` share on KPI-B | The guest views the KPI list and details | KPI-B is visible in their KPI list and detail page (`kpis.detail`); all other workspace KPIs remain inaccessible. |
| AC-3 | A Member with a `read` or `update` share in FlowyTeam | The FlowyTeam import runs | No redundant `access_bindings` row is created, and the import report increments `coveredByRoleCount`. |
| AC-4 | The owner of KPI-A (`ownerMemberId`) | The owner shares KPI-A with a Viewer at `edit` level | `kpis.share` succeeds, creates an access binding, writes an audit row, and the Viewer can immediately edit KPI-A. |
| AC-5 | A workspace Admin or Owner | The Admin revokes a share via `kpis.unshare` | The binding is soft-deleted, access falls back to the member's workspace role, and the audit row records the Admin. |
| AC-6 | A Member who is not the owner of KPI-A and not an Admin/Owner | The Member attempts to call `kpis.share` or `kpis.unshare` | The operation is refused with forbidden error (`full` / 90 required). |
| AC-7 | A FlowyTeam dataset with 50 `indicator_accesses` (20 covered by role, 15 new Viewer edits, 10 guest views, 5 placeholder members) | A dry run of the importer is executed | The report counts 25 shares to write, 20 covered by role, 5 skipped placeholders, and lists all non-transferable view frequencies and view options. |
| AC-8 | A FlowyTeam indicator with visibility restricted exclusively to 2 users | The importer pre-flight check runs | The report flags the KPI for human review, warning that OpenOKR workspace Members will have visibility into this KPI. |

## 10. Open questions

All previous questions Q1 and Q2 from the initial draft are settled:
- **Q1 (Timing)**: Settled by Akmal on 19 November 2026. Scheduled for release 0.10.0 (G4-Q1).
- **Q2 (Grant Authority)**: Settled by Akmal and Agung on 19 November 2026. Granted to the KPI owner (`ownerMemberId`), a workspace Owner, or an Admin (`full` / 90 on the KPI).

### Remaining question

| # | Question | Recommended | Alternative |
|---|---|---|---|
| Q3 | **Share list read visibility**: Should any member with `view` on a KPI be allowed to see who has explicit shares (`kpis.shares` required level `view`), or should it require `full`? | **Level `view` (10).** Transparency matches other resources (space members, task assignees) and allows viewers to see who is responsible for or contributing to a KPI. | Level `full` (90) only. Keeps sharing lists restricted to admins and owners. |
