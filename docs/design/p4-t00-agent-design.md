# P4-T00: the agent design

Part two of the Phase 4 design gate. Authority: AI-NATIVE-PLAN.md SS6,
METHOD.md SS7.3, SS11. Implemented at P4-T04 (nudge engine), P4-T05
(Champion), P4-T06 (Coach).

## 0. What already exists

| Component | Package | Ships at | What it holds |
|---|---|---|---|
| `agents` table | `packages/db` | P2-T17 | Agent rows: kind, persona, instructions, schedule, autonomy, scope |
| `agent_runs` table | `packages/db` | P2-T17 | Run state machine: planning, running, completed, failed, cancelled |
| `proposed_changes` table | `packages/db` | P2-T17 | Proposal envelopes for review inbox |
| `run-executor.ts` | `packages/agents` | P2-T17 | Run lifecycle, task list, tool loop, cost metering |
| `escalation.ts` | `packages/method` | P3-T06 | Check-in escalation ladder as pure function |
| `cadence/engine.ts` | `packages/core` | P3-T06 | Staleness sweep, next-check-in computation |
| `cadence/service.ts` | `packages/core` | P3-T06 | Cadence reads and writes |

P4-T04 through P4-T06 build on these. This document specifies what they add.

## 1. The OKR Coach

Identity: a seeded agent member with `kind = 'coach'`. One per workspace,
created at provisioning.

### 1.1 Schedule and triggers

| Timing | What it does | Deterministic (AI off)? |
|---|---|---|
| On every goal/KR write | Evaluate the SS4 quality catalogue, store strength score and flags | Yes |
| On every alignment change | Recompute the SS5.2 structural findings | Yes |
| On phase transition | Check phase completion, list blocking items | Yes |
| On publish attempt | Evaluate the six gates, refuse with specifics | Yes |
| Nightly | Semantic sweep: duplicates, conflicts, divergence, drift | Structural only; semantic needs AI |
| On demand | Review a goal, space or whole tree | Yes for structural; AI adds rewrite suggestions |

### 1.2 Deterministic-with-AI-off matrix

| Behaviour | AI on | AI off |
|---|---|---|
| Quality check evaluation (SS4) | Yes + suggested rewrite | Yes, no rewrite |
| Strength score computation | Yes | Yes |
| Structural alignment findings | Yes | Yes |
| Semantic alignment findings (SS5.3) | Yes | No |
| Gate enforcement | Yes | Yes |
| Divergence detection (health vs data) | Yes | Yes |
| Trend-off-track detection | Yes | Yes |
| Rewrite assist | Yes | Hidden |
| Phase-moment messages (SS10 items 8, 14) | Yes (natural language) | Yes (rule citation only) |

### 1.3 Scope and access

Least privilege. The Coach member group gets explicit bindings on:
- Named spaces (read + quality flags write)
- Goals within those spaces
- KPI trees within those spaces

Never a workspace-wide grant. Cannot reach a space it is not bound to.
A finding on a goal outside scope is not generated, not hidden.

### 1.4 Write policy

Default: `propose`. Every quality finding, relink suggestion, and rewrite
is a proposal envelope in `proposed_changes`. A human applies or dismisses.
Applying commits through the normal Operation pipeline with audit.

`scoped_direct`: opt-in per workspace. Writes quality flags directly.
Still fully audited. Structural findings are still proposals.

### 1.5 Findings table

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `workspace_id` | uuid | RLS |
| `source` | `'engine'` or `'coach'` | Engine = structural, Coach = semantic |
| `kind` | string | `relink`, `dependency`, `conflict`, `gap`, `divergence`, `trend` |
| `severity` | `'info'`, `'warning'`, `'error'` | |
| `subject_goal_id` | uuid, nullable | Null for anchor findings (AL-4) |
| `related_goal_id` | uuid, nullable | The other goal in a conflict pair |
| `reason` | text | Specific, not generic |
| `rule_key` | string | Resolves to a check or trigger in the method package |
| `dismissed` | boolean | Dismissing on one side dismisses everywhere |
| `dismissed_by` | uuid, nullable | |
| `one_click_applicable` | boolean | True when the fix is mechanical (re-parent, add dependency) |

The `alignment_findings` table from P3-T09 is this table. P4-T06 adds the
`source = 'coach'` rows. Engine findings are recomputed structurally; coach
findings survive until dismissed or the condition clears.

## 2. The OKR Champion

Identity: a seeded agent member with `kind = 'champion'`. One per workspace,
created at provisioning.

### 2.1 Schedule

| Frequency | What it does |
|---|---|
| Hourly | Drain the nudge queue: what is due now, per member, per channel |
| Daily (member's timezone) | Morning summary, staleness sweep, blocker aging, KPI corridor checks |
| Weekly | Open and close the session, assemble the digest, update the streak |
| Per cycle | Planning countdown, quarterly review preparation pack |

### 2.2 Deterministic-with-AI-off matrix

| Behaviour | AI on | AI off |
|---|---|---|
| Check-in chase (nudges, escalation) | Yes | Yes |
| Acknowledgement chase | Yes | Yes |
| Blocker clock | Yes | Yes |
| Session open/close, streak | Yes | Yes |
| Digest assembly | Yes (natural language summary) | Yes (template-based) |
| KPI corridor check | Yes | Yes |
| Recovery OKR drafting | Yes (refined language) | Yes (template from SS6.5) |
| Planning countdown | Yes | Yes |
| Quarterly review preparation pack | Yes (narrative) | Yes (data only) |
| Morning summary | Yes (natural language) | Yes (bullet list) |

### 2.3 Scope and access

Same least-privilege model as the Coach. Bindings on:
- Named spaces (nudge targets within)
- Goals within those spaces (check-in and blocker reads)
- KPI trees within those spaces (corridor reads)

**As implemented at P4-T05a:** one binding per space, at `view`, added by
`createSpaceInTx` as each space is created. Goals and KPI trees are reached
through the space's own access context rather than bound one by one, which is
how every other principal reaches them; a per-goal binding would be a second
access model beside the one `can()` already resolves. `view` rather than `edit`
because everything the agent changes goes through a proposal, and a proposal
needs no write grant. There is no binding on the workspace context, and a test
reads `access_bindings` back to assert the absence.

### 2.4 Write policy

Default: `propose` for recovery OKRs, check-in drafts, and any data write.
Nudges and digests are notifications, not proposals (they do not write domain
data).

## 3. The trigger catalogue

Every proactive message. Each row writes a nudge record. Rule keys ship as data
in `packages/method`; a message citing a key the package does not define fails
the build.

### 3.1 Rhythm triggers (owned by the Champion)

| Rule key | Fires | Default recipient | Escalation? | Deterministic? |
|---|---|---|---|---|
| `checkin.due_soon` | 1 day before anchor | Champion | No | Yes |
| `checkin.due` | On anchor day | Champion | No | Yes |
| `checkin.overdue` | Daily past due, escalating | Champion, then ladder | Yes | Yes |
| `checkin.stale` | Grace exceeded | Champion + reviewer | No | Yes |
| `ack.owed` | 1 day after publication | Reviewer | No | Yes |
| `ack.overdue` | 3 days after publication | Reviewer, then ladder | Yes | Yes |
| `blocker.warning` | 20h after opening | Blocker owner | No | Yes |
| `blocker.overdue` | 24h after opening | Coordinator | Yes | Yes |
| `blocker.escalated` | 48h after opening | Sponsor | Yes | Yes |
| `confidence.critical` | KR scored <= 0.3 | Coordinator, same day | Yes | Yes |
| `commitment.due` | End of commitment week | Owner | No | Yes |
| `session.due_soon` | 1 day before weekly session | Coordinator + space | No | Yes |
| `session.open` | Scheduled start | Space | No | Yes |
| `session.missed` | 1 day after missed session | Coordinator, then sponsor | Yes | Yes |
| `streak.at_risk` | Week would break streak | Coordinator | No | Yes |
| `digest.weekly` | After session closes | Space + leadership | No | Yes |
| `digest.daily` | Member's local morning | Opted-in members | No | Yes |
| `kpi.watch` | KPI enters watch corridor | KPI owner | No | Yes |
| `kpi.unhealthy` | KPI enters unhealthy corridor | KPI owner + sponsor | No | Yes |
| `kpi.recovery_proposed` | Unhealthy for two consecutive periods (§11 `kpi.recoveryProposalDelayPeriods`) | KPI owner, carrying a drafted recovery OKR | No, the draft is `draftRecovery` in `packages/method` | Yes |
| `kpi.recovered` | Real achievement re-enters the healthy corridor | KPI owner, proposing to close the recovery OKR | No | Yes |
| `cycle.planning_opens` | 6w (annual) or 3w (quarterly) before start | Sponsor + facilitator | No | Yes |
| `cycle.phase_blocked` | Phase conditions unmet as window closes | Facilitator | No | Yes |
| `cycle.deadline` | 14, 7, 1 days before publication deadline | Sponsor + facilitator | No | Yes |
| `cycle.starts` | Day one | Everyone | No | Yes |
| `cycle.review_due` | 2 weeks before cycle ends | Facilitator | No | Yes |
| `cycle.closing` | Cycle ends unscored | Facilitator + sponsor | No | Yes |

### 3.2 Quality triggers (owned by the Coach)

| Rule key | Fires | Default recipient | Escalation? | Deterministic? |
|---|---|---|---|---|
| `quality.draft_failing` | Live as draft is written | Author, inline | No | Yes |
| `quality.gate_blocked` | On publish attempt | Facilitator | No | Yes |
| `quality.no_not_doing` | Phase 3 exit without not-doing list | Sponsor + facilitator | No | Yes |
| `quality.too_many_objectives` | Level exceeds cap | Facilitator | No | Yes |
| `quality.all_lagging` | All KRs lagging | Champion | No | Yes |
| `quality.no_baseline` | KR lacks baseline at Phase 4 exit | Champion | No | Yes |
| `quality.sandbagging_draft` | Avg draft confidence > 0.9 | Champion + facilitator | No | Yes |
| `quality.sandbagging_close` | Scores cluster > 0.85 at close | Sponsor | No | Yes |
| `quality.orphan_goal` | Goal below company has no parent | Champion | No | Yes |
| `quality.level_skip` | Alignment skips a level | Champion | No | Yes |
| `quality.silo` | Dept subtree has no horizontal dep | Department lead | No | Yes |
| `quality.conflict` | Two goals double-count or oppose each other, from the nightly semantic sweep | Both champions, with the reason | No | **No.** The only trigger in this table that needs the provider: it is a judgement about meaning, so with AI off it does not fire and nothing is claimed |
| `quality.dependency_unowned` | Dep unconfirmed, no risk owner | Champion | No | Yes |
| `quality.no_cuts` | Capacity checked, nothing cut | Facilitator | No | Yes |
| `quality.divergence` | Health disagrees with data | Champion + reviewer | No | Yes |
| `quality.trending_off` | Forecast misses target | Champion | No | Yes |
| `quality.process_health_low` | Process-health statement scores low | Sponsor | No | Yes |

### 3.3 Blocked triggers (awaiting P3 tasks)

> **BLOCKED: awaits P3-T14**
>
> | Rule key | Fires | Recipient |
> |---|---|---|
> | `kpi.recovery_proposed` | Unhealthy for 2 periods | KPI owner, with drafted recovery OKR |
> | `kpi.recovered` | Achievement re-enters healthy corridor | KPI owner, proposing close |

> **BLOCKED: awaits P3-T16**
>
> | Rule key | Fires | Recipient |
> |---|---|---|
> | `quality.conflict` | Two goals double-count (semantic sweep) | Both champions, as comment thread |

> **BLOCKED: awaits P3-T17**
>
> The acceptance criteria for P4-T05 and P4-T06 run agents against the demo
> workspace. The demo workspace (P3-T17) does not exist yet.

## 4. The escalation ladders

Three ladders. All configurable via SS11 parameters (already in `thresholds.ts`).

### 4.1 Check-in ladder

Already implemented in `packages/method/src/escalation.ts`.

| Step | After | Goes to | SS11 parameter |
|---|---|---|---|
| 0 | Due-soon lead (1 day before) | Champion | `cadence.dueSoonLeadDays` |
| 1 | Due date | Champion | Implicit |
| 2 | 1 day overdue | Champion (repeat) | `cadence.checkInLadderDays.championRepeat` |
| 3 | Grace exceeded (3 days) | Champion + reviewer | `cadence.stalenessGraceDays` |
| 4 | 7 days | Champion + reviewer + coordinator | `cadence.checkInLadderDays.coordinator` |
| 5 | 14 days | All four roles | `cadence.checkInLadderDays.sponsor` |

Targets accumulate. The champion is never dropped.

### 4.2 Acknowledgement ladder

| Step | After | Goes to | SS11 parameter |
|---|---|---|---|
| 1 | 1 day after publication | Reviewer | `cadence.acknowledgementLadderDays.nudge` |
| 2 | 3 days after publication | Reviewer + coordinator | `cadence.acknowledgementLadderDays.escalate` |

### 4.3 Blocker ladder

| Step | After | Goes to | SS11 parameter |
|---|---|---|---|
| 1 | 20 hours | Blocker owner | `cadence.blockerLadderHours.owner` |
| 2 | 24 hours | Coordinator | `cadence.blockerLadderHours.coordinator` |
| 3 | 48 hours | Sponsor | `cadence.blockerLadderHours.sponsor` |

## 5. Deduplication rules

From SS11 `cadence.nudgeDeduplicationHours` (24h) and the trigger catalogue.

| Rule | Detail |
|---|---|
| Window | 1 nudge per subject per member per day (24h) |
| Exception | An escalation step increase bypasses deduplication |
| Volume ceiling | SS11 `cadence.nudgeCeilingPerWeek` (10 per member per week) |
| Enforcement | The nudge engine checks before inserting. A suppressed nudge writes a suppression record with the reason |

## 6. Quiet hours

| Rule | Detail |
|---|---|
| Timezone | Member's own timezone |
| Window | Configurable per member (default: no quiet hours) |
| During quiet hours | Nudges queue to the next open window |
| Exception | Urgent escalations (marked by the workspace) deliver during quiet hours |
| Workspace quiet mode | Silences everything except escalations |
| Snooze | Per-nudge snooze silences the nudge. Never silences the review-inbox obligation |

## 7. The nudge record

Every proactive message is a recorded row, per CLAUDE.md hard rule.

**Corrected on 2026-08-18.** This table originally listed a shorter row with
the recipient as `member_id`, no `kind`, no `agent_id`, no `scheduled_for`, no
`acted_at`, and suppression split across a boolean and a reason.
TECHNICAL-PLAN.md §4 already specified the table and it outranks a design
document, so the columns below are its. Whoever reads only this section now
reads what actually shipped.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `workspace_id` | uuid | RLS |
| `kind` | string | `rhythm` or `quality`: which agent's remit, as §6.4's two tables split them. The volume dashboard reads by it, because "the Champion is noisy" is a different finding from "the Coach is" |
| `subject_type` | string | `goal`, `check_in`, `blocker`, `kpi`, `session`, `cycle` |
| `subject_id` | uuid | |
| `recipient_member_id` | uuid | The recipient |
| `agent_id` | uuid, nullable | Null when the product produced it rather than a seeded agent. The due engine runs before either agent exists, and a fabricated id would misattribute it forever |
| `rule_key` | string | Resolves to the §6.4 trigger catalogue. Text rather than an enum: the catalogue is data in `packages/method` and the conformance suite keeps the two in step |
| `channel` | string | `in_app`, `email`, `slack`, `teams`, etc. |
| `scheduled_for` | timestamp | When it should go out |
| `sent_at` | timestamp, nullable | When it did. Two columns because quiet hours and batching move delivery without changing the decision, and one timestamp could not tell "held until morning" from "never sent" |
| `acted_at` | timestamp, nullable | When the recipient did the thing it asked for. This is what makes a nudge measurable rather than merely countable |
| `escalation_step` | smallint | 0 for non-escalating, 1+ for ladder |
| `suppressed_reason` | string, nullable | `dedup`, `quiet_hours`, `snooze`, `disabled`, `ceiling`. Null when it was sent. Four of the five are decisions the product made rather than accidents, which is why they are recorded |
| `snoozed_until` | timestamp, nullable | |
| `created_at` | timestamp | |

A suppressed nudge is never also sent, enforced as a check constraint: both
halves of the record are meaningless without the other.

## 8. Prompt design per cycle phase

Each agent carries staged instructions that vary by the cycle's current phase.
The instructions are versioned like prompts (AI-NATIVE-PLAN.md SS6.5).

| Phase | Coach emphasis | Champion emphasis |
|---|---|---|
| 0 Annual strategy | Warn if annual set > 5 objectives | Countdown to planning open |
| 1 Prepare | Input pack completeness, lead time | Planning countdown, facilitator readiness |
| 2 Diagnose | Prior cycle scoring factual, not appraisal | Score collection, KPI baselines |
| 3 Set direction | Not-doing list, trade-offs | Deadline countdown |
| 4 Draft OKRs | Quality checks live, rewrite assists | Draft progress, baseline gaps |
| 5 Align and commit | Dependencies, capacity, silo detection | Publication deadline, cuts |
| 6 Run the cadence | Divergence, trend forecast | Check-in chase, blocker clock, digest |
| 7 Review and learn | Diagnostic, sandbagging at close | Review preparation, minutes |

## 9. Acceptance criteria

Given a champion who misses their check-in, when the engine runs over the
following fortnight, then they are nudged on the due day and once daily after,
the reviewer is brought in at the grace boundary, the coordinator at seven
days and the sponsor at fourteen, each step recorded and visible to the
champion.

Given a burst of triggers on one subject, when the nudge engine runs, then
only one nudge is produced per member per day, and the suppression record
names the deduplication rule.

Given a workspace with AI off, when every trigger in the catalogue fires, then
every deterministic trigger still fires and no AI-dependent trigger is
delivered.

Given two goals in different spaces that double-count the same metric, when
the nightly sweep runs, then a conflict finding appears for both champions
with a specific reason, and dismissing it on one side dismisses it everywhere.

Given a simulated month against the demo workspace, when the nudge engine runs
daily, then the total nudge count per member stays under the SS11 volume ceiling.

## 10. What P4-T05b built, and where it departs from §2.1

Written when the daily, weekly and per-cycle runs landed. §2.1's table stands;
this records what is behind each row today so nobody reads the table as a claim
about what runs.

| §2.1 row | Built | Not built, and why |
|---|---|---|
| Hourly: the nudge queue | P4-T05a, whole | |
| Daily: morning summary | Yes, at the member's own local hour | |
| Daily: staleness sweep | Yes, calling P3-T06's `sweepStaleness` on the run's transaction | |
| Daily: blocker aging | Yes, over P4-T07c's `blockers` table | Nothing stamps `escalated_at`: a nudge reader writing it would record an escalation as though somebody had acted |
| Daily: KPI corridor checks | Yes, all four §6.4 triggers | |
| Weekly: open and close the session | The three lifecycle messages | The digest and the streak are P4-T08's, which is the task that builds a digest table and a streak engine |
| Per cycle: planning countdown | Yes, five rules | `cycle.phase_blocked` needs gate state rather than a date, and belongs to the Coach at P4-T06a |
| Per cycle: review preparation pack | The `cycle.review_due` message | The pack itself is P4-T11's content. This says it is time; it assembles nothing |

**Three decisions worth carrying forward.**

**The morning summary's preference is `notification_settings`.**
`daily_summary` and `daily_summary_time` have been there since P2-T06,
defaulting to on at 08:00 in the member's own timezone, which is what
TECHNICAL-PLAN §4.14 specifies. §6.4's "opted-in members" therefore reads as
opt-out. The row is created lazily, so the reader left joins and falls back to
the table's own defaults.

**`session.missed` is one day wide.** §6.4 says "1 day after missed session" and
§11 has no parameter for it. The condition is the plain fact that the scheduled
day passed with the session never opened, and the window closes at forty-eight
hours. A permanent `missed` state would nudge about a session from March every
day until somebody deleted the row.

**Urgency is read from the trigger catalogue, never chosen per call site.**
`urgent` bypasses quiet mode, the member's quiet hours *and* the weekly ceiling,
so a message that repeats daily and is also urgent is unbounded noise. Only a
trigger the catalogue marks as escalating earns the bypass, and never on the
owner's own copy of it. `kpi.unhealthy` and `cycle.closing` both repeat for as
long as their condition holds and are both non-urgent for that reason.

### 10.1 Acceptance criteria

Given a goal three days past its staleness grace, when the daily run executes,
then that goal reads `outdated`, a second run changes nothing, and no check-in
nudge is produced by that run.

Given a blocker opened twenty-five hours ago, when the daily run executes, then
`blocker.overdue` reaches its named owner and at least one member other than the
owner, at escalation step 2.

Given a blocker that has been resolved, when the daily run executes at any point
on its clock, then no blocker nudge is produced.

Given a member whose local time is their configured summary hour, when the daily
run executes, then they receive one `digest.daily` nudge whose subject is
themselves; at any other local hour they receive none.

Given a weekly session nobody opened, when the weekly run executes on the
following day, then its facilitator is told once; two days later, nothing.

Given a publication deadline fourteen days away, when the per-cycle run
executes, then the sponsor and the facilitator are each told once, and on the
following day neither is told again.

Given a cycle past its end date with status `active`, when the per-cycle run
executes, then the close is chased; once the cycle reads `closed`, it is not.
