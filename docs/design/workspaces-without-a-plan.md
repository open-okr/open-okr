# Workspaces without a plan

Plan 0.8.0 row O2. On an instance with a plan catalogue, a workspace with no
plan may not use the provider's AI key, and nothing says so. This design makes
the operator console say what having no plan costs, and gives the operator one
audited action that puts every such workspace on the default plan. It changes
stored tenant data, so it needs "design approved" before the code.

Authority: Q6, decided by Akmal on 10 November 2026 (plan section 3.6):
**nothing automatic**, the console says what having no plan costs and offers
this one action. `docs/design/ai-credits.md` §3 is the rule it explains.

## 1. What is true today

| Fact | Where |
|---|---|
| A workspace starts on the default plan only if `cloud.defaultPlan` names one when the workspace is made | `packages/core/src/tenancy/plans.ts`, `resolveDefaultPlan` |
| `pnpm cloud:adopt` and the hourly adoption give a workspace made before the cloud flag a tenant record with no plan | `packages/core/src/bin/cloud-adopt.ts` |
| With a catalogue, a workspace with no plan, or on a plan with no AI credits, may not use the provider's key | `docs/design/ai-credits.md` §3 |
| Since O1 (0.8.0) the workspace's own screens say why: "This workspace's plan includes no AI credits" | `packages/core/src/ai/off-reason.ts`, `plan_without_credits` |
| S-45 can filter to workspaces with no plan, and says nothing about what that costs | `apps/web/app/operator/page.tsx` |
| S-46 changes one workspace's plan, with a required reason, refusing a plan with fewer seats than are in use. One Operation, audited as `workspace.changePlan` with `by: operator`, and it ends any trial | `apps/web/app/operator/[workspaceId]/plan-actions.ts`, `packages/core/src/operator/plans.ts`, `applyPlanInTx` |

OKRGoal met all of it at once: its catalogue and its default plan went in after
its first workspaces existed, so every one of them lost AI on the provider's key
and nobody was told.

## 2. What the console says

| Where | Shown when | What it says |
|---|---|---|
| S-45, each row | The catalogue is not empty and the workspace has no plan | A `warn` chip "No plan", and beside it "No AI on the provider's key" |
| S-45, above the list | At least one workspace has no plan | "{count} workspaces have no plan. On this instance that means no AI on the provider's key, and no seat limit." and, when `cloud.defaultPlan` names a catalogue plan, a button "Review putting them on {plan}". With no default plan: "Set `cloud.defaultPlan` to offer putting them on it." |
| S-46, the plan card | The same as a row | "No plan. This workspace cannot use the provider's AI key until it is on a plan with AI credits." |

With an empty catalogue, which is every self-hosted instance and a cloud that
sells nothing, nothing is shown, because there the provider's key is available
to every workspace (§3's first row).

## 3. The action

**Two steps, so the operator sees what will happen before it does.**

| Step | Route | What happens |
|---|---|---|
| Review | `/operator/default-plan` (GET) | Lists every workspace with no plan, each with its people in use against the default plan's seats, split into "Will move" and "Will be refused: {used} people, the plan has {seats} seats". Names the default plan and its AI credits a month. When those are zero it says so before anything else: "{plan} includes no AI credits, so moving these workspaces sets a seat limit and does not give them AI." A reason field, prefilled with "Put on the default plan from the console", required as on S-46 |
| Confirm | A server action on that page | Applies the plan to exactly the workspaces the review listed under "Will move", then shows the result per workspace |

**One Operation per workspace, the one S-46 already runs.** Each move is
`workspace.changePlan` through `setPlanAsOperator`, in that workspace's own
transaction, so row-level security, the seat check, the activity row and the
audit row are the ones a single change writes. The audit payload gains
`bulk: true`. No new write path.

**What can change between the two steps is checked again, not trusted.**

| Between review and confirm | Result for that workspace |
|---|---|
| It was given a plan | Skipped: "Already on {plan}" |
| It gained people past the seats | Refused by `applyPlanInTx`, with its sentence |
| It was closed or erased | Skipped |

**One instance audit row for the whole run**, `operator.default_plan_filled`,
with the operator, the plan key, the reason and the three counts (moved,
refused, skipped), on the instance chain beside each workspace's own row.

**A trial is not touched.** A workspace on a trial has the trial's plan, so it
is never listed.

## 4. Settings and data

No new setting: the action reads `cloud.defaultPlan` and `cloud.plans`, both
in TECHNICAL-PLAN §4.14 already. No migration and no data-change script: the
writes are operator actions through the Operation pipeline, and each changes
one existing column, `tenants.plan_key`, with `seats`.

## 5. Acceptance criteria

```
Given a catalogue with Free (5 seats, 100 AI credits) as the default plan
And workspaces A (3 people) and B (8 people) with no plan
When the operator opens S-45
Then A and B each show "No plan" and "No AI on the provider's key"
And the list says 2 workspaces have no plan, with "Review putting them on Free"

When the operator opens the review
Then A is under "Will move" and B under "Will be refused: 8 people, the plan has 5 seats"

When the operator confirms with the reason prefilled
Then A is on Free, its audit row is workspace.changePlan with by operator and bulk true
And B is unchanged and the result names why
And the instance chain holds one operator.default_plan_filled row: 1 moved, 1 refused, 0 skipped

Given the default plan has no AI credits
When the operator opens the review
Then it says moving sets a seat limit and does not give AI, before the list

Given A was put on Team on S-46 after the review was opened
When the operator confirms
Then A is skipped with "Already on Team" and stays on Team

Given an empty catalogue
Then S-45 and S-46 show nothing about plans and AI
```

## 6. Tests

| Test | Kind |
|---|---|
| The review splits by seats; the default plan's AI credits sentence; no default plan | Core, against a real database, `packages/core/test/default-plan-fill.test.ts` |
| The run moves, refuses and skips as the table in §3 says, one `workspace.changePlan` per moved workspace and one instance row | Same file |
| A non-operator is refused, as `setPlanAsOperator` refuses | Same file |
| The chips and the card on S-45 and S-46, and nothing with an empty catalogue | Unit, `apps/web/test` |
| The operator reviews and confirms; a workspace over its seats stays put | End to end, `e2e/s45-operator-console.spec.ts`, using the hosting helpers that already make workspaces and a catalogue |

## 7. What it does not do

- Nothing runs by itself, now or on a schedule (Q6).
- It does not choose a plan other than the default, and it does not set seats.
  A workspace refused for seats is moved one at a time on S-46, where the
  operator names the seats.
- It does not mail the workspaces' owners. The plan change appears in each
  workspace's activity feed, as a single change on S-46 does today (O2-Q3).
- It does not mark a workspace on a plan with zero AI credits. That plan was
  chosen; having none was not.

## 8. What the specification gains

`docs/design/ai-credits.md` §3: a pointer to this note for what the console
shows. UIUX-PLAN §6, S-45 and S-46, and the review page as part of S-45.

## 9. Open questions

| # | Question | Options | Recommended |
|---|---|---|---|
| O2-Q1 | Offer the action when the default plan has no AI credits? | Offer it and say so first; or not offer it | **Offer it and say so.** Seats and a plan are worth having on their own, and the operator decides with the sentence in front of them |
| O2-Q2 | The reason: required and prefilled, or fixed? | Required and prefilled; fixed text; none | **Required and prefilled**, as S-46 requires one, so the audit trail always says why |
| O2-Q3 | Mail each moved workspace's owner? | No; yes | **No.** A single change on S-46 mails nobody, and the activity feed shows it. A plan that gives AI back is visible on the copilot at once |
| O2-Q4 | The review as its own page, or a dialog on S-45? | Page; dialog | **Page.** The list can be long, and a GET page is one the operator can reload or share before confirming |
