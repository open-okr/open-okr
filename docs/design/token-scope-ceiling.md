# A token's scopes are a ceiling for every write it causes

Status: proposed 9 November 2026 for release 0.7.0, waiting for "design approved". Akmal asked for the fix the same night; it changes access, so it is designed first (CLAUDE.md).

Authority: TECHNICAL-PLAN §14 ("scoped bearer tokens"), `api-contract.md` §4 and §5 (`insufficient_scope`), `agent-surface.md` §5.3 (a scope refusal is audited), the A13 build report that found the gap.

## 0. What is wrong

A token carries scopes: `read`, `write`, `destructive`. REST and the agent endpoint check the scope against the safety class of the action named in the request, once, before anything runs.

Four actions run another action inside themselves, through `callAction`, on behalf of the caller:

| Action | Its safety | What it runs |
|---|---|---|
| `proposals.apply` | write | Whatever an agent proposed |
| `proposals.bulkApply` | write | The same, many at once |
| `copilot.applyProposal` (and its undo) | write | Whatever the copilot proposed |
| `alignment.applyFinding` | write | The finding's one-click fix |

So a token with `write` and without `destructive` can apply a proposal whose action is destructive (`goals.delete`, `sessions.close`, `people.convertToGuest`, and the rest O6 marked) and run it. The scope check saw a write and let it through. The person who minted the token chose not to grant destructive; the product did not hold to that. A13 made no proposal destructive, but its close proposal (approved for 0.7.0) carries `sessions.close`, which is.

The browser is not affected: a signed-in person has no scopes, only their access level, and every nested action checks that level as it always has.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| C1 | **The ceiling travels with the call, not with the context object.** When `callAction` receives a context that names token scopes, it runs the action inside an `AsyncLocalStorage` scope holding them, the way the dry run (D4) is carried. Every `callAction` reached inside checks the action it is asked for against that ceiling | The four call sites build their own context for the nested call. A rule that depends on each of them copying a field is a rule the fifth one forgets. Carried this way, a nested call cannot escape it |
| C2 | **The check is the same one the surface makes**: the nested action's safety class must be in the token's scopes. A read needs `read`, a write `write`, a destructive action `destructive` | One rule, already documented and already understood by whoever minted the token |
| C3 | **`ActionCallContext.scopes`**, optional. REST and the agent endpoint set it from the resolved token. Absent everywhere else (the browser, the scheduler, the relay, chat commands, the importer), which means no ceiling, exactly as today | Only a token has scopes. Nothing that works today changes |
| C4 | **The refusal is `insufficient_scope`** (403), naming the nested action and the scope it needs: "Applying this proposal runs goals.delete, which needs the destructive scope. This token has: read, write." The outer write rolls back, so the proposal stays pending | The code a client already handles for the same mistake one level up. Saying which action is what lets a person mint the right token |
| C5 | **Audited where a scope refusal already is.** The agent endpoint records it as A3 does, with the nested action named. REST does not audit scope refusals today and does not start here | Consistent with A3 and with REST's own rule |
| C6 | **The review inbox is unchanged.** A person applying from the browser has no scopes and is held by their access level, as now | The gap is only in tokens |

## 2. Acceptance criteria

- Given a REST token with `read` and `write`, when it calls `proposals.apply` on a proposal whose action is `goals.delete`, then the answer is 403 `insufficient_scope` naming `goals.delete` and `destructive`, the goal is not deleted and the proposal stays pending.
- Given the same token, when the proposal's action is `goals.update`, then it is applied as today.
- Given a token with `destructive` as well, when it applies the `goals.delete` proposal, then the goal is deleted.
- Given a person in the browser, when they apply the `goals.delete` proposal from the review inbox with full access to the goal, then it is applied as today.
- Given `proposals.bulkApply` with one destructive proposal among three, from a `write` token, then the destructive one is refused with its reason and the others apply, as bulk apply reports any other refusal.
- Given an agent token over the agent endpoint, when a nested action is refused this way, then the refusal is recorded as A3 records a scope refusal.

## 3. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/scope-ceiling.test.ts` | The ceiling: a nested write inside a `write` scope, a nested destructive refused, no ceiling without scopes, nested twice |
| Integration | `packages/core/test/proposal-decisions.test.ts` (existing) | Apply and bulk apply with a scoped context |
| Integration | `packages/core/test/copilot-proposals.test.ts` and `alignment.test.ts` (existing) | The other two callers |
| Route | `apps/web/test/rest-action-context.test.ts` (existing) | REST sets `scopes` on the context; `insufficient_scope` comes back for the nested refusal |

## 4. Question for Akmal

None. The change only refuses what a token was never granted; every path that works today without a token is unchanged.
