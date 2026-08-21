/**
 * The daily sweep: what a day changes that no single write does (P4-T05b).
 *
 * AI-NATIVE-PLAN.md §6.2 gives the Champion a daily run covering "the morning
 * summary in each member's local timezone, the staleness sweep, blocker aging,
 * KPI corridor checks". Three of those four are here. The fourth is named below
 * with the task that fills it, rather than left out silently.
 *
 * **The staleness sweep is not in this file, and it already exists.** P3-T06
 * built it as `sweepStaleness` in `../cadence/service.ts` and exposed it as
 * `pnpm cadence:sweep`, because no scheduler host ran then and none runs now.
 * The daily run calls that function rather than re-deriving it, so a health
 * flip is one piece of code whether a human typed the command or the agent's
 * run reached it.
 *
 * **Blocker aging reads P4-T07c's table and does not define one.** The ladder
 * has been a golden-master tested pure function in
 * `packages/method/src/escalation.ts` since P3-T06 with nothing to read;
 * P4-T07c landed `blockers` while this task was being written, so the reader is
 * here rather than deferred. `PHASE-4-SPLIT.md` names this exact handoff and its
 * rule: read the ladder, never rewrite it, and the table is P4-T07c's shape.
 */
import {
  activeOnly,
  blockers,
  goals,
  keyResults,
  kpiRecords,
  kpis,
  notificationSettings,
  spaceMembers,
  type WorkspaceTx,
  workspaceMembers,
} from "@openokr/db";
import {
  blockerEscalation,
  isTriggerKey,
  type KpiDirection,
  type KpiState,
  kpiAchievement,
  kpiState,
  type ResolvedThresholds,
  shouldProposeRecovery,
  shouldProposeRecoveryClose,
  trigger,
} from "@openokr/method";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { AgentDrafter } from "../agents/drafter.ts";
import { DEFAULT_DAILY_SUMMARY_TIME } from "../notifications/settings.ts";
import { OperationError } from "../operations/errors.ts";
import { resolveCoordinator } from "../spaces/roles.ts";
import {
  type DueNudge,
  goalRolesFor,
  memberForRole,
  type NudgeProposal,
} from "./service.ts";

/** The rule key each corridor state earns, or nothing where a state is silent. */
const RULE_FOR_STATE: Partial<Record<KpiState, string>> = {
  watch: "kpi.watch",
  unhealthy: "kpi.unhealthy",
};

/**
 * Who hears about a KPI.
 *
 * A member-owned KPI has its owner on the row. A space-owned one resolves to
 * the space's coordinator, falling back to the manager through §4.2's one rule
 * rather than a second copy of it here. A workspace-owned KPI has no owner and
 * gets no nudge: escalating a metric to everybody is escalating it to nobody,
 * and §6.4 names the recipient as "KPI owner" rather than "the workspace".
 */
async function kpiOwner(
  tx: WorkspaceTx,
  kpi: {
    readonly ownerKind: string;
    readonly memberId: string | null;
    readonly spaceId: string | null;
  },
): Promise<string | null> {
  if (kpi.ownerKind === "member") {
    return kpi.memberId;
  }
  if (kpi.ownerKind !== "space" || !kpi.spaceId) {
    return null;
  }
  const holders = await tx
    .select({ memberId: spaceMembers.memberId, role: spaceMembers.role })
    .from(spaceMembers)
    .where(activeOnly(spaceMembers, eq(spaceMembers.spaceId, kpi.spaceId)))
    .orderBy(asc(spaceMembers.createdAt));
  return resolveCoordinator(holders) ?? null;
}

/**
 * Whether this message gets through quiet hours and past the weekly ceiling.
 *
 * **Read from the catalogue, never chosen per call site.** `urgent` bypasses
 * workspace quiet mode, the member's own quiet hours *and* the ten-a-week
 * ceiling, so a message that repeats daily and is also urgent is unbounded
 * noise. §6.4 already records which triggers escalate, and only an escalation
 * has earned the bypass: that is what P4-T04c's own note means by "somebody
 * other than the owner of the work is being told".
 *
 * The first draft of this file marked `kpi.unhealthy` and `cycle.closing`
 * urgent by hand. Both repeat for as long as the condition holds, so both would
 * have sailed past the ceiling that exists to stop exactly that, which is the
 * defect a simulated month found in the check-in ladder at P4-T04c.
 *
 * The owner's own reminder is never urgent, whatever the step. Being told about
 * your own blocker is not an escalation.
 */
export function urgentFor(ruleKey: string, recipientIsOwner: boolean): boolean {
  if (recipientIsOwner) {
    return false;
  }
  return trigger(ruleKey)?.escalates === true;
}

/** One nudge, with the rule key checked against the catalogue before it exists. */
function nudge(input: {
  readonly ruleKey: string;
  readonly subjectType: DueNudge["subjectType"];
  readonly subjectId: string;
  readonly recipientMemberId: string;
  readonly urgent: boolean;
  readonly proposal?: NudgeProposal;
}): DueNudge {
  if (!isTriggerKey(input.ruleKey)) {
    // Loud rather than skipped, the same refusal `service.ts` makes. A rule key
    // nothing defines is a defect in this file or in the catalogue, and a nudge
    // nobody can trace back to a rule is the one thing CLAUDE.md forbids
    // outright.
    throw new OperationError(
      "forbidden",
      `\`${input.ruleKey}\` is not a rule the method package defines.`,
    );
  }
  return {
    ruleKey: input.ruleKey,
    kind: "rhythm",
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    recipientMemberId: input.recipientMemberId,
    channel: "in_app",
    // Step 0: none of the sweep's messages climbs a ladder. §6.4 marks every
    // one of them as not escalating, so a step above zero would be claiming a
    // widening that never happens.
    escalationStep: 0,
    urgent: input.urgent,
    ...(input.proposal ? { proposal: input.proposal } : {}),
  };
}

/**
 * Every KPI corridor nudge due in this workspace (§6.4, METHOD.md §6.4).
 *
 * Four triggers over one read. `kpi.watch` and `kpi.unhealthy` come from the
 * stored state, which the recompute writes and this never recalculates: a sweep
 * that re-derived health from the records would be a second opinion about a
 * number the product already committed to.
 *
 * `kpi.recovery_proposed` and `kpi.recovered` are the two §6.5 predicates, and
 * both are asked here rather than answered here. They are pure functions in
 * `packages/method`, and this loads the periods and the flags they need.
 *
 * Nothing is written to the KPI. The closure stamp `recovery_close_proposed_at`
 * belongs to the recompute that raised it (P3-T14), and a sweep that stamped it
 * would make "exactly once" depend on which of two paths ran first.
 */
export async function dueKpiCorridorNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly thresholds: ResolvedThresholds;
    /**
     * The cycle a proposed recovery objective would live in.
     *
     * A recovery objective is an objective and an objective belongs to a cycle,
     * so with no open cycle there is nothing to propose into and the nudge goes
     * out without a proposal attached. Told rather than nothing: the owner still
     * learns the KPI has been unhealthy for two periods.
     */
    readonly cycleId?: string;
    /** Language for the recovery objective's title (P4-T05c-b). */
    readonly drafter?: AgentDrafter;
  },
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      id: kpis.id,
      title: kpis.title,
      state: kpis.state,
      direction: kpis.direction,
      achievementPct: kpis.achievementPct,
      healthyPct: kpis.healthyPct,
      watchPct: kpis.watchPct,
      ownerKind: kpis.ownerKind,
      memberId: kpis.memberId,
      spaceId: kpis.spaceId,
      recoveryGoalId: kpis.recoveryGoalId,
      recoveryCloseProposedAt: kpis.recoveryCloseProposedAt,
    })
    .from(kpis)
    .where(activeOnly(kpis, eq(kpis.workspaceId, input.workspaceId)));

  const delay = input.thresholds["kpi.recoveryProposalDelayPeriods"];
  const due: DueNudge[] = [];

  for (const kpi of rows) {
    const owner = await kpiOwner(tx, kpi);
    if (!owner) {
      continue;
    }

    // The corridor message itself. `healthy`, `recovering` and `no_data` are
    // all silent: a metric inside its corridor needs no message, a recovering
    // one already has an objective attached, and one nobody has recorded is
    // unmeasured rather than failing.
    const corridorRule = RULE_FOR_STATE[kpi.state];
    if (corridorRule) {
      due.push(
        nudge({
          ruleKey: corridorRule,
          subjectType: "kpi",
          subjectId: kpi.id,
          recipientMemberId: owner,
          // §6.4 sends the unhealthy message to "KPI owner + sponsor". A KPI
          // has no cycle and therefore no sponsor to resolve, so the widening
          // has no target and the message stays with the owner. It repeats for
          // as long as the metric is out of its corridor, so the ceiling is
          // what bounds it: see `urgentFor`.
          urgent: urgentFor(corridorRule, true),
        }),
      );
    }

    const achievement =
      kpi.achievementPct === null ? null : Number(kpi.achievementPct);
    const recovery = await recoveryLinkFor(tx, input.workspaceId, kpi);

    if (recovery === "none") {
      // §6.5: the proposal waits for consecutive unhealthy periods, so one bad
      // month never generates an unsolicited OKR. The states are recomputed
      // from the stored records rather than read from a column, because the
      // column holds today's state and this question is about a run of them.
      const periods = await periodStatesFor(tx, input.workspaceId, kpi);
      if (shouldProposeRecovery(periods, delay)) {
        // A better sentence than the template, when a model can write one.
        // Null is the ordinary answer and not a failure: §6.5's template is
        // what P3-T14 golden-master tested and what the deterministic path has
        // always proposed.
        const refined = await refinedRecoveryTitle(
          input.drafter,
          kpi.title,
          achievement,
        );
        due.push(
          nudge({
            ruleKey: "kpi.recovery_proposed",
            subjectType: "kpi",
            subjectId: kpi.id,
            recipientMemberId: owner,
            urgent: urgentFor("kpi.recovery_proposed", true),
            // The proposal is `kpis.launchRecovery` with the ids, and nothing
            // else. §6.5's drafter is what that action already calls, so the
            // objective and its key results are produced when a human applies
            // it, from the tree as it stands then rather than as it stood when
            // the proposal was raised. A payload carrying drafted titles would
            // go stale the moment somebody added a driver.
            //
            // Deterministic, and marked as such: this is a template, not a
            // model. P4-T05c-b is what adds a refined title and sets the flag.
            ...(input.cycleId
              ? {
                  proposal: {
                    action: "kpis.launchRecovery",
                    payload: {
                      kpiId: kpi.id,
                      cycleId: input.cycleId,
                      ...(refined ? { objectiveTitle: refined } : {}),
                    },
                    // True only where a model chose the words. The ids and the
                    // key results are still §6.5's, produced when a human
                    // applies it.
                    aiGenerated: refined !== null,
                  } as const,
                }
              : {}),
          }),
        );
      }
      continue;
    }

    if (
      shouldProposeRecoveryClose({
        // Real achievement, never the effective figure. Closing on the
        // projection would close a recovery because the recovery was going
        // well, which is circular. §6.5, and P3-T14 made the same call.
        achievementPct: achievement,
        recovery,
        alreadyProposed: kpi.recoveryCloseProposedAt !== null,
        healthyPct: Number(kpi.healthyPct),
      })
    ) {
      due.push(
        nudge({
          ruleKey: "kpi.recovered",
          subjectType: "kpi",
          subjectId: kpi.id,
          recipientMemberId: owner,
          urgent: urgentFor("kpi.recovered", true),
        }),
      );
    }
  }

  return due;
}

/**
 * A model's title for a recovery objective, or nothing.
 *
 * Never throws, for the reason the check-in drafter does not: a provider having
 * a bad minute must not stop the corridor being reported. RECOVERY_PLACEHOLDER
 * wording stays §6.5's whenever this returns null.
 */
async function refinedRecoveryTitle(
  drafter: AgentDrafter | undefined,
  kpiTitle: string,
  achievementPct: number | null,
): Promise<string | null> {
  if (!drafter) {
    return null;
  }
  try {
    return await drafter.refineRecoveryTitle({
      kpiTitle,
      templateTitle: `Bring ${kpiTitle} back to target`,
      achievementPct,
    });
  } catch {
    return null;
  }
}

/** Whether a linked recovery goal is open, closed, or absent (METHOD.md §6.4). */
async function recoveryLinkFor(
  tx: WorkspaceTx,
  workspaceId: string,
  kpi: { readonly recoveryGoalId: string | null },
): Promise<"none" | "open" | "closed"> {
  if (!kpi.recoveryGoalId) {
    return "none";
  }
  const [goal] = await tx
    .select({ closedAt: goals.closedAt })
    .from(goals)
    .where(
      activeOnly(
        goals,
        eq(goals.id, kpi.recoveryGoalId),
        eq(goals.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!goal) {
    return "none";
  }
  return goal.closedAt === null ? "open" : "closed";
}

/**
 * This KPI's corridor state per recorded period, oldest first.
 *
 * `shouldProposeRecovery` reads the tail of this list, so the order is part of
 * the contract rather than a convenience. A period with no actual value is
 * `no_data` and resets the run: a gap in the data is not a bad month.
 */
async function periodStatesFor(
  tx: WorkspaceTx,
  workspaceId: string,
  kpi: {
    readonly id: string;
    readonly direction: KpiDirection;
    readonly healthyPct: string;
    readonly watchPct: string;
  },
): Promise<readonly KpiState[]> {
  const rows = await tx
    .select({
      targetValue: kpiRecords.targetValue,
      actualValue: kpiRecords.actualValue,
    })
    .from(kpiRecords)
    .where(
      activeOnly(
        kpiRecords,
        eq(kpiRecords.workspaceId, workspaceId),
        eq(kpiRecords.kpiId, kpi.id),
      ),
    )
    .orderBy(asc(kpiRecords.periodStart));

  const corridor = {
    healthyPct: Number(kpi.healthyPct),
    watchPct: Number(kpi.watchPct),
  };
  return rows.map((row) => {
    // Achievement per period is derived, not stored: `kpi_records` holds the
    // target and the actual, and §6.4's ratio is the one function that turns
    // them into a percentage. Reading a stored column here would need a column
    // that does not exist, and computing the ratio a second way would give the
    // sweep its own opinion about a number the grid already shows.
    const { pct } = kpiAchievement(
      kpi.direction,
      row.actualValue === null ? null : Number(row.actualValue),
      row.targetValue === null ? null : Number(row.targetValue),
    );
    // "none" rather than the KPI's real recovery link: this asks what each
    // period looked like on its own terms, and a recovery opened last month
    // would otherwise rewrite the history that justified opening it.
    return kpiState(pct, "none", corridor);
  });
}

/**
 * The morning summary, for the members whose local morning it is (§6.4).
 *
 * One nudge per member, subject the member themselves, so the deduplication
 * window holds it to one a day without a second mechanism. The window is what
 * makes an hourly run safe here: the reader fires for every hour that matches a
 * member's chosen hour, and any run inside the same day finds the row it already
 * wrote and holds the second.
 *
 * **The preference is `notification_settings`, not a column of its own.**
 * `daily_summary` and `daily_summary_time` have been there since P2-T06,
 * defaulting to on at 08:00 in the member's own timezone, which is exactly what
 * TECHNICAL-PLAN §4.14 specifies. The first draft of this reader added a second
 * pair of columns to `workspace_members` before that table was found; two homes
 * for one preference is a preference nobody owns.
 *
 * The row is created lazily, so most members have none. A left join plus the
 * table's own defaults is therefore the whole rule: a member who has never
 * opened their settings gets the summary, which is what "nothing must be
 * configured before the product works" means here.
 *
 * Not urgent, deliberately. A morning summary that pushed through quiet hours
 * or past the weekly ceiling would be the product deciding its own newsletter
 * outranks the limits a workspace set.
 */
export async function dueDailyDigestNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly workspaceTimeZone: string;
  },
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      id: workspaceMembers.id,
      kind: workspaceMembers.kind,
      timezone: workspaceMembers.timezone,
      dailySummary: notificationSettings.dailySummary,
      dailySummaryTime: notificationSettings.dailySummaryTime,
    })
    .from(workspaceMembers)
    .leftJoin(
      notificationSettings,
      and(
        eq(notificationSettings.memberId, workspaceMembers.id),
        isNull(notificationSettings.deletedAt),
      ),
    )
    .where(
      activeOnly(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.status, "active"),
        ),
      ),
    );

  const due: DueNudge[] = [];
  for (const member of rows) {
    // An agent is a member row and reads no summaries. Sending the Champion its
    // own morning digest is a loop, not a feature.
    if (member.kind === "agent") {
      continue;
    }
    // No row means the table's default, which is on. Only an explicit false
    // turns it off.
    if (member.dailySummary === false) {
      continue;
    }
    const hour = localHourIn(
      input.now,
      member.timezone ?? input.workspaceTimeZone,
    );
    if (
      hour !==
      summaryHour(member.dailySummaryTime ?? DEFAULT_DAILY_SUMMARY_TIME)
    ) {
      continue;
    }
    due.push(
      nudge({
        ruleKey: "digest.daily",
        // The subject is the member, so the deduplication window holds the
        // summary to one a day per person without a second mechanism. 0037 adds
        // `member` to the subject types: the alternative was storing a member
        // id under `goal`, which would read as a goal to every query that
        // joins on it.
        subjectType: "member",
        subjectId: member.id,
        recipientMemberId: member.id,
        urgent: urgentFor("digest.daily", true),
      }),
    );
  }
  return due;
}

/**
 * The hour out of a stored "HH:MM".
 *
 * Minutes are deliberately ignored. The daily run is checked hourly, so a
 * summary set to 08:30 arrives in the 08:00 hour; storing a minute the product
 * cannot honour would be a setting that quietly does nothing. An unparseable
 * value falls back to the §4.14 default rather than to midnight, because
 * midnight is the one hour a "morning summary" must never mean.
 */
function summaryHour(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  const hour = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return Number(DEFAULT_DAILY_SUMMARY_TIME.slice(0, 2));
  }
  return hour;
}

/** The member's own local hour, for the one comparison that decides morning. */
function localHourIn(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
}

/**
 * The rule key each blocker ladder step earns (§6.4).
 *
 * Step 1 is the warning that arrives **before** the deadline, at twenty hours
 * of a twenty-four hour clock. Steps 2 and 3 are past it, and the key changes
 * because the message does: the owner is being reminded, and then somebody
 * other than the owner is being told.
 */
const RULE_FOR_BLOCKER_STEP: Record<number, string> = {
  1: "blocker.warning",
  2: "blocker.overdue",
  3: "blocker.escalated",
};

/**
 * Every blocker aging nudge due in this workspace (§6.4, METHOD.md §7.3).
 *
 * The clock is hours, not days, because §11 gives it twenty-four and a ladder
 * measured in days could not fire twice inside one. `blockerEscalation` decides
 * which step; this resolves the step's roles to members and writes nothing to
 * the blocker.
 *
 * **The owner is the blocker's own owner, not the goal's champion.** The ladder
 * returns `champion` for step 1 because that is its name for "the person whose
 * problem this is", and for a blocker that person is the member named on the row
 * when it was opened. Escalating a blocker to a goal's champion instead would
 * send it past the one person who agreed to the next action.
 *
 * **Nothing stamps `escalated_at`.** That column and `escalated_to_id` are
 * P4-T07c's, on a table it owns, and a nudge reader that wrote to them would be
 * recording an escalation as though somebody had acted on it. The nudge row
 * already carries the step, which is the record of what the product said.
 *
 * A resolved blocker owes nobody anything, whatever its clock says.
 */
export async function dueBlockerNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly thresholds: ResolvedThresholds;
  },
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      id: blockers.id,
      goalId: blockers.goalId,
      keyResultId: blockers.keyResultId,
      ownerId: blockers.ownerId,
      openedAt: blockers.openedAt,
    })
    .from(blockers)
    .where(
      activeOnly(
        blockers,
        eq(blockers.workspaceId, input.workspaceId),
        isNull(blockers.resolvedAt),
      ),
    );

  const due: DueNudge[] = [];
  for (const blocker of rows) {
    const hours =
      (input.now.getTime() - blocker.openedAt.getTime()) / 3_600_000;
    const step = blockerEscalation(hours, input.thresholds);
    if (step.step === null) {
      continue;
    }
    const ruleKey = RULE_FOR_BLOCKER_STEP[step.step];
    if (!ruleKey) {
      // Loud rather than skipped, the same refusal the check-in ladder makes: a
      // step with no key is a defect in this map or in the ladder, not a nudge
      // to swallow.
      throw new OperationError(
        "forbidden",
        `Blocker escalation step ${step.step} has no rule key the catalogue defines.`,
      );
    }

    const goalId = blocker.goalId ?? (await goalForKeyResult(tx, blocker));
    const roles = goalId
      ? await goalRolesFor(tx, input.workspaceId, goalId)
      : null;

    const recipients = new Set<string>();
    for (const role of step.targets) {
      if (role === "champion") {
        // The blocker's own owner, for the reason in the note above.
        recipients.add(blocker.ownerId);
        continue;
      }
      if (!roles) {
        continue;
      }
      const memberId = await memberForRole(tx, roles, role);
      if (memberId) {
        recipients.add(memberId);
      }
    }

    for (const recipient of recipients) {
      due.push({
        ruleKey,
        kind: "rhythm",
        subjectType: "blocker",
        subjectId: blocker.id,
        recipientMemberId: recipient,
        channel: "in_app",
        escalationStep: step.step,
        // Same rule as the check-in ladder, from the same reasoning: the owner
        // being reminded about their own blocker is not an escalation, and
        // does not earn a quiet hour. Anybody else hearing about it is, and
        // §6.4 marks these two steps as escalating.
        urgent: urgentFor(ruleKey, recipient === blocker.ownerId),
      });
    }
  }
  return due;
}

/** The goal a key-result blocker belongs to, so its roles can be resolved. */
async function goalForKeyResult(
  tx: WorkspaceTx,
  blocker: { readonly keyResultId: string | null },
): Promise<string | null> {
  if (!blocker.keyResultId) {
    return null;
  }
  const [row] = await tx
    .select({ goalId: keyResults.goalId })
    .from(keyResults)
    .where(activeOnly(keyResults, eq(keyResults.id, blocker.keyResultId)))
    .limit(1);
  return row?.goalId ?? null;
}
