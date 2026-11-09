# A dependency names the key result that delivers it

Status: proposed 9 November 2026 for release 0.7.0 (plan O5), waiting for "design approved". A schema change, so it is designed first.

Authority: METHOD.md §5.4 and §2.10, TECHNICAL-PLAN §4.5 and §7.2. Scenario: Northwind NW-Q1-20, gap G-5 (`docs/scenarios/northwind-year/05-scenario-index.md` §3).

NW-Q1-20: Mei ticks E3.1, "Bulk import generally available", done. P1.1 depends on Engineering for exactly that. The step expects the dependency to read as delivered. Today nothing can say so, because the register names the providing team and not what the team delivers.

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The register | `packages/db/src/schema/alignment.ts:88-131`, migrations 0025 and 0124 | The depending key result, a providing space or free text (a check needs one of them), a note, confirmation with who and when, a risk owner, and an escalation |
| Adding an entry | `packages/core/src/actions/alignment.ts:386-476` (`goals.addKeyResultDependency`) | `edit` on the depending key result's goal |
| Confirming | `packages/core/src/actions/alignment.ts:478-616` (`goals.confirmDependency`) | Only a member who can edit the providing space |
| Gate 4 | `packages/core/src/alignment/service.ts:604-614` (`blocksPublish`) | Unconfirmed, not escalated and with no risk owner blocks. METHOD.md §4.5 |
| Reading it | `loadDependencyRegister` (`packages/core/src/alignment/service.ts:617`), used by `goals.relations` (the S-14 drawer, `packages/core/src/actions/goal-relations.ts:272`) and `alignment.read` (S-10, `packages/core/src/actions/alignment.ts:1405`); the monthly review's log reads the table itself (`packages/core/src/actions/sessions.ts:4844`) | Provider shown as a space name or the text |
| What "done" means | `key_results.kind`, `done_at`, `progress_pct` (`packages/db/src/schema/goals.ts:234-252`) | METHOD.md §2.10: a milestone is 0% until done, then 100%; a baseline the same once recorded; a metric runs to its target; a maintain reads 100% while inside its band |
| The seed | `packages/core/src/demo/year/q1-plan.ts:808-820` | P1.1 depends on Engineering, and the dependency is confirmed |
| Importer mapping | TECHNICAL-PLAN §7.2, line 487 | `key_result_dependencies` has no legacy source |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| K1 | **One new column, `provider_key_result_id uuid`, nullable**, references `key_results (id) on delete set null`, with a check that it is not the depending key result | Optional, because a supplier or a regulator has no key result here. `set null` matches `provider_space_id` |
| K2 | **The providing key result must belong to a goal a space owns**, and the write sets `provider_space_id` to that space. A `providerSpaceId` that names another space is refused | METHOD.md §5.4 names "the providing team". Confirmation and the silo check both work from the space, so they keep working unchanged, and the existing "space or text" check needs no change. A company or personal goal has no team to confirm it |
| K3 | **Naming it.** `goals.addKeyResultDependency` takes an optional `providerKeyResultId`. A new write action, `goals.setDependencyProvider { id, providerKeyResultId \| null }`, names, changes or clears it later. Both need `edit` on the depending goal, as adding does today, and `view` on the providing goal through the access getter | The register entry belongs to the depending team. Naming another team's key result discloses nothing the namer cannot already see, and a key result they cannot see answers not-found |
| K4 | **The providing team can name it as it confirms.** `goals.confirmDependency` takes an optional `providerKeyResultId`, which must sit in the confirming space | The providing team knows which of its key results delivers. That is the most accurate moment to say so |
| K5 | **Changing the providing key result on a confirmed entry clears the confirmation.** Clearing it to none keeps the confirmation. The response's `blocksPublish` says when gate 4 is now red | A confirmation is a promise about something specific. A different key result, possibly in a different space, is a different promise |
| K6 | **"Delivered" is computed at every read and never stored.** One pure function, `dependencyDelivery`, in `packages/core/src/alignment/delivery.ts`, from the providing key result's `progress_pct`, `deleted_at` and its goal's close | `progress_pct` is recomputed in the writing transaction (§7 of `okr-core-domain.md`), so the chip and the progress bar can never disagree. A stored flag would be a second copy that drifts |
| K7 | The states: `delivered` when the key result exists and reads 100%; `stopped` when it is deleted, or its goal is closed below 100%; `pending` otherwise; `hidden` when the reader cannot view the providing goal; and none when no key result is named | For a milestone or a baseline, 100% is exactly `done_at` set. A maintain key result reads delivered while inside its band and can go back to pending, which is what it promised. `stopped` tells the depending team the delivery is not coming |
| K8 | **Hidden means hidden.** A reader who cannot view the providing goal sees the space and confirmation as today, and "a key result in Engineering" with no title and no state | The state would leak whether a goal the reader cannot open has reached its target |
| K9 | The three reads (`goals.relations`, `alignment.read`, the monthly review's log) gain `providerKeyResult: { id, title, goalId, goalTitle, progressPct, state } \| null`. Visibility is decided once per read through `visibleResourceIds`, the set filter `alignment.read` already uses | One authorisation call per read, not one per row (P7-T01b) |
| K10 | **Delivery settles nothing.** Gate 4, the silo check and the alignment score are unchanged | METHOD.md §4.5 names three ways to settle a dependency: confirmed, escalated, risk-owned. Adding "delivered" would be a METHOD.md change |
| K11 | Migration: the column, the check, and a partial index on `provider_key_result_id where provider_key_result_id is not null`. The next free number | The index is for the foreign key: erasing a workspace deletes its key results, and without it each delete scans the register |

The table keeps the tenant policy migration 0025 gave it. The column is additive, so the previous release reads and writes the table unchanged during a rolling upgrade.

## 2. Open question

**Q1. When the providing key result is delivered, is the depending key result's owner told?** That is a new proactive message kind (a nudge with its own rule key), which is yours to decide. Proposed: **not in this change.** The drawer and the register show it, and the owner meets it at their next check-in. If yes, it would be a Champion message, `dependency.delivered`, once per dependency, designed with the trigger catalogue.

## 3. Acceptance criteria

- Given P1.1 depends on Engineering and Mei confirms it naming E3.1, when Mei marks E3.1 done, then Sara's drawer on P1 shows the dependency as delivered by E3.1, and the dependency row was not written.
- Given a dependency naming a maintain key result inside its band, when a reading leaves the band, then the dependency reads pending again.
- Given a dependency naming a key result whose goal is closed at 60%, when anybody who can see it opens the register, then it reads stopped.
- Given a reader who cannot view the providing goal, when they open the depending goal, then the entry names the space, shows no title and no state, and the response carries neither.
- Given a member who cannot view a key result, when they name it as a provider, then it is refused as not-found.
- Given a key result in a member's personal goal, when it is named as a provider, then it is refused, saying a provider must be a team's key result.
- Given a confirmed dependency, when the depending team names a different providing key result, then it is no longer confirmed and `blocksPublish` is true unless a risk owner or an escalation holds it.
- Given a confirmed dependency with a key result named, when the key result is cleared, then it stays confirmed.
- Given a delivered dependency that is unconfirmed and unowned, when the cycle publishes, then gate 4 is red as it is today.
- Given `providerKeyResultId` equal to the depending key result, when it is added, then the database refuses it.
- Given a workspace archive holding a dependency with a providing key result, when it is imported, then the column points at the new key result.

## 4. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/core/test/dependency-delivery.test.ts` (new) | The five states from each key result kind, deleted, closed |
| Integration | `packages/core/test/alignment.test.ts` (existing) | Naming on add, set and confirm; the space rule; confirmation cleared; gate 4 unchanged |
| Integration | `packages/core/test/key-result-dependencies.test.ts` (new) | The three reads, including the hidden case, with one access call per read |
| Integration | `packages/core/test/portability-import.test.ts` (existing) | The remap of the new column |
| Integration | `packages/core/test/year-q1-plan.test.ts` (existing) | The seed names E3.1 when Mei confirms, and NW-Q1-20 reads delivered |
| Browser | `e2e/s14e-dependency-delivered.spec.ts` (new) | Name a providing key result, mark it done, see delivered in the drawer and on S-10 |

## 5. Documents changed in the same change

- TECHNICAL-PLAN §4.5: the column on `key_result_dependencies`.
- TECHNICAL-PLAN §7.2: the existing "no legacy source" row covers the new column, and says delivery is derived, so an import has nothing to recompute.
- DATABASE.md, both `key_result_dependencies` entries.
- UIUX-PLAN S-10 (a "Delivered by" column with the state), S-14 (the drawer register) and S-23 (the dependency and risk log).
- `docs/scenarios/northwind-year/05-scenario-index.md`: G-5 removed. The seed names E3.1 at Mei's confirmation.
- The contract artifacts, regenerated for the new and changed inputs, and the new action's toolset.
- `docs/runbooks/upgrade.md`, "0.6 to 0.7": one additive migration, nothing to choose.
- `packages/ui/src/i18n/messages/en.json` and `ms.json`.

## 6. What this does not do

- No link between a blocker and a dependency. Closing the blocker in NW-Q1-20 stays Sara's act.
- No message when a dependency is delivered, unless Q1 says otherwise.
- No goal-level provider: `goal_dependencies` (§5.1 links) are unchanged.
- No list on the providing key result of who depends on it.
- No change to gate 4, the silo check, the alignment score or METHOD.md.
