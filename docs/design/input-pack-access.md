# Who may change the input pack

Status: **written 13 November 2026, waiting for "design approved"**. Plan 0.9.0 row G8. Akmal approved the direction on 12 November 2026 (plan §10, "Design directions"), answering Q-4 of Obed's 0.8.0 acceptance test: in this release, limited to the Owner, Admins and the named facilitator. A change to access, so it is designed before code (CLAUDE.md).

## 1. What is true today

| Fact | Where |
|---|---|
| `workflow.setPackItem` (an item gathered or missing, and its note) and `workflow.distributePack` (Confirm distribution) ask `edit` and name no domain | `packages/core/src/actions/cycle-workflow.ts:713`, `:770` |
| Every active member holds `edit` on the workspace context through the self-service binding, so every Member passes | `docs/design/workspace-roles.md` §11 and §12 |
| The screen draws the controls on the same `canEdit` it uses for the rest of the cycle page | `apps/web/app/cycle/input-pack.tsx`, `apps/web/app/cycle/page.tsx:640` |
| A cycle names its facilitator in `cycles.facilitator_id`, a member, who may be a Member | `packages/db/src/schema/cycles.ts:183` |
| R1 (0.8.0) gave the cycle's setup writes the domain `workspace`, so the Owner (`full`) and an Admin (`edit`) pass by their role, and a Member (`view`) does not | `workspace-roles.md` §12, `writeFloorFor` in `packages/core/src/operations/operation.ts` |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Who may change the pack:** an actor whose workspace-domain write floor is `edit` or more (`writeFloorFor(tx, { domain: "workspace" })`, R1's check), or the human member named as the cycle's `facilitator_id` while that member is `active` | The direction. The Owner and Admins by role, the facilitator by name. Not the sponsor |
| D2 | **No facilitator, or a suspended or removed one:** the Owner and Admins only | The direction. A suspended member is refused by `resolveActor` anyway; the rule names it so nobody reads it as a gap |
| D3 | **What it covers:** marking an item gathered or missing, its note, and Confirm distribution. Exactly `workflow.setPackItem` and `workflow.distributePack` | The direction. Nothing else on phase 1 changes |
| D4 | **Enforced in the writes, in the operation's `load` step**, which runs before the change inside the transaction against the freshly loaded cycle row. A refusal is `forbidden` with the sentence "Only an Owner, an Admin or this cycle's facilitator can change the input pack." REST, the command line, the agent surface and the chat commands are all projections of the same action, so all are refused alike | CLAUDE.md: authorise before the change against freshly loaded rows, one rule, never the screen alone |
| D5 | **The access level stays `edit` with no domain.** The rule is "R1's floor OR the facilitator", which a domain alone cannot say; the extra condition lives in one shared function, `mayChangeInputPack(tx, { workspaceId, actor, cycleId })`, in `packages/core/src/cycles/input-pack-access.ts` | A domain of `workspace` would refuse the facilitator who is a Member |
| D6 | **Agents are refused.** An agent has no role and is never a cycle's facilitator, so D1 refuses it. Neither the Coach nor the Champion calls these two actions today | Least privilege; no agent autonomy change |
| D7 | **A new read for the screen:** `workflow.read` gains `packAccess: { canChange: boolean, who: string }`, computed by the same `mayChangeInputPack`. `who` is the sentence naming who may change it, with the facilitator's name when there is one: "Only an Owner, an Admin or Siti Rahman, this cycle's facilitator, can change the input pack." | The direction: "a new read telling the screen". One function for the screen and the write, so they cannot disagree |
| D8 | **Everybody else sees the pack read only**: the seven items with their gathered state and notes, the distribution date, no toggles, no note fields, no Confirm distribution, and the `who` line above the list | The direction |
| D9 | **No migration and no data change.** Marks and notes already made stay as they are, whoever made them | The direction |
| D10 | **The demo and the Northwind year keep working**: their pack steps act as the workspace's founder, who is the Owner | Checked: `packages/core/src/demo/year/q1-plan.ts` NW-P-04 and the builder call through `context.action`, the founder |

## 3. Who passes

| Actor | Workspace write floor | Facilitator of this cycle | May change the pack |
|---|---|---|---|
| Owner | `full` | either | Yes |
| Admin | `edit` | either | Yes |
| Member | `view` | yes, active | **Yes** |
| Member | `view` | no | **No, new** |
| Member named facilitator, suspended | refused by `resolveActor` | | No |
| Viewer | `view` | yes | Yes. The direction names the facilitator without a role condition; see Q1 |
| A role a workspace made | its own workspace level | either | Yes when it grants `edit` or more, otherwise only as facilitator |
| Guest | none | n/a: a guest cannot be named facilitator | No |
| Agent | none | never | No |
| Support session | the level the owner granted | never | Yes when the owner granted `edit` or more, as for R1 |

## 4. Where it is built

| Piece | File |
|---|---|
| The rule | `packages/core/src/cycles/input-pack-access.ts`: `mayChangeInputPack` |
| The writes | `packages/core/src/actions/cycle-workflow.ts`: `load` on `setPackItem` and `distributePack` |
| The read | `workflow.read` output `packAccess` |
| The screen | `apps/web/app/cycle/input-pack.tsx` takes `packAccess` in place of `canEdit` for the pack; `page.tsx` passes it |
| Catalogue | `packages/ui/src/i18n/messages/{en,ms}.json`: the `who` sentence with and without a facilitator |
| Contract | `pnpm gen:contract` (the read's output changes) |
| Docs | `workspace-roles.md` §12 gains a line pointing here; UIUX-PLAN S-06 (the input pack) says who may change it |

## 5. Acceptance criteria

- Given a Member who is not the cycle's facilitator, when they open phase 1, then the pack is read only and the line names who may change it.
- Given the same Member, when they call `workflow.setPackItem` or `workflow.distributePack` through REST, then the call is refused as forbidden and nothing changes, and no activity or audit row is written.
- Given the cycle's named facilitator, who is a Member, when they mark an item gathered, then it is saved, with the activity and audit rows as today.
- Given an Admin, when they press Confirm distribution, then it is recorded.
- Given a cycle with no facilitator, when a Member opens phase 1, then the line says only an Owner or an Admin can change it.
- Given a facilitator who is then suspended, when the Owner opens phase 1, then the Owner can still change the pack, and the suspended member cannot sign in to try.
- Given an agent token with edit on the cycle's space, when it calls `workflow.setPackItem`, then it is refused.

## 6. Tests

| Kind | Where | What |
|---|---|---|
| Unit and integration | `packages/core/test/input-pack-access.test.ts` | §3's table, row by row, through `callAction` with the test-support factory |
| End to end | `e2e/` the cycle phase 1 spec | A Member sees the read-only pack and the line; the facilitator marks an item |

## 7. Questions the direction did not settle

| # | Question | Recommended | Other option |
|---|---|---|---|
| Q1 | A Viewer named as facilitator: may they change the pack? | Yes. The direction names the facilitator without a role condition, and a workspace that named a Viewer facilitator meant them to run the cycle | Require the facilitator's role to be Member or above |
| Q2 | Does the cycle's sponsor get it too? | No, as the direction says ("not the sponsor") | |
