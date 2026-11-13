# Access to one KPI, and FlowyTeam's KPI shares

Status: **written 13 November 2026, waiting for "design approved"**. Agung on 13 November 2026: Q2 as recommended (its owner, an Owner or an Admin); Q1 and the approval wait for Akmal. Plan 0.9.0 row G4. On 13 November 2026 Agung chose to build access per KPI before importing FlowyTeam's KPI shares (G4-Q3), after the build found that nothing reads a binding on one KPI. A change to access, so it is designed before code (CLAUDE.md).

## 1. What is true today

| Fact | Where |
|---|---|
| A human's access to a KPI is the workspace role's level on the `kpi` domain: Owner and Admin `full`, Member `edit`, Viewer `view`. No KPI action names the KPI as its subject | `packages/core/src/access/roles.ts`, `packages/core/src/actions/kpis.ts` |
| The access getter resolves `workspace`, `space`, `goal`, `initiative`, `task` and a few more to their own context. `kpi` is not among them | `SUBJECT_RESOLVERS`, `packages/core/src/access/reads.ts:479` |
| A KPI with no space gets a `kpi` context at creation, used only so the Coach and the Champion can be bound to it. A KPI in a space has no context of its own | `kpis.ts:483`, `packages/core/src/agents/scope.ts` `agentSeesKpi` |
| A binding can only raise access: a role and a binding compose by taking the maximum, and there is no deny rule | CLAUDE.md, "Object authorisation" |
| FlowyTeam's `indicator_accesses`: a user, `read` or `update`, a view option and a view frequency, per indicator | `docs/specification/reference/flowyteam-okr-kpi-tasks-model.md` §4.4 |

**What that means for the import.** Because a binding never lowers access, per-KPI bindings can only matter for somebody whose role gives less than the share: a **Viewer** with an `update` share would gain `edit` on that one KPI, and a **guest** (no workspace role) with any share would gain that KPI. A Member already holds `edit` on every KPI, so a Member's share changes nothing. FlowyTeam's other half, a KPI that only its sharers can see, cannot be reproduced: that would be a deny, which the product does not have.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| KA-D1 | **Every KPI owns a `kpi` context.** New KPIs get one at creation whatever their owner; a data change gives every existing KPI without one its context (batched, idempotent by ledger) | One resolver, no special case for KPIs in a space |
| KA-D2 | **`kpi: ownContextResolver("kpi")` joins `SUBJECT_RESOLVERS`**, and the KPI's context sits under its owner's context (its space's, or the workspace's), so a space binding still reaches every KPI in the space | The same shape as an initiative and a task |
| KA-D3 | **KPI reads and writes that take a `kpiId` name it as their subject**, so the floor is the maximum of the role's `kpi` level and any binding on the KPI's context. Lists stay on the role level and add the KPIs a binding opens | The rule CLAUDE.md states: role and bindings, through one `can()` |
| KA-D4 | **Nothing is lowered.** The role still grants what it grants. A binding only adds | No deny rule |
| KA-D5 | **One human way to grant it**: `kpis.share` (`{ kpiId, memberId, level: "view" \| "edit" }`) and `kpis.unshare`, access `full` on the KPI (its owner, an Owner or an Admin), audited. The KPI page lists who has a share | A binding nobody can see or remove is worse than none |
| KA-D6 | **The import**: each `indicator_accesses` row becomes `kpis.share` for that member, `read` as `view` and `update` as `edit`, through a non-agent `kpis.importShare` that skips a placeholder member the way watchers do. The view option and frequency are counted and named in the import report. A share that adds nothing (the member's role already covers it) is counted as "covered by role", not written | G4-Q, G4-Q2, and the report says the truth about each row |
| KA-D7 | **`kpi_shares` stays unused**, marked "no legacy source" and "not read", and is left for a later release to drop through the two-release rule | Two tables for one grant would disagree |
| KA-D8 | **Agents unchanged**: `agentSeesKpi` already reads `kpi` and `space` bindings | |

## 3. Size and risk

| Piece | Size |
|---|---|
| A data change for KA-D1, the resolver, and the context at creation | S |
| KA-D3 across the KPI actions (about 16) and their lists | M: every KPI read is touched, so every KPI test runs in CI |
| `kpis.share`, `kpis.unshare`, the KPI page's share list, catalogue | S to M |
| The import (KA-D6) | S |

About a week in all. The plan says G2 is the row to move if 0.9.0 runs long; this is now the larger one.

## 4. Acceptance criteria

- Given a Viewer with an `update` share imported from FlowyTeam, when they open that KPI, then they can record a value; on any other KPI they cannot.
- Given a guest in a space with a `read` share on a workspace KPI, when they open it, then they can see it.
- Given a Member with a `read` share, then nothing changes for them and the import report counts the row as covered by role.
- Given an Admin, when they remove a share, then the member's access falls back to their role, and the audit names the Admin.
- Given a dry run of the importer, then the report counts shares written, shares covered by role, and the view options and frequencies it could not keep.

## 5. Questions

| # | Question | Recommended | Other option |
|---|---|---|---|
| Q1 | Build all of this in 0.9.0, or only the import's report now (count the shares, say which are covered by role, list the Viewer `update` shares that will not carry over) and the per-KPI access in 0.10? | **The report now, the access in 0.10.** The only people a share would change anything for are Viewers with `update` and guests, the release is already the copilot's, and every KPI read is touched | All of it in 0.9.0, about a week |
| Q2 | Who may share a KPI (KA-D5)? | Its owner, an Owner or an Admin (`full` on the KPI) | Anybody with `edit` on it |
