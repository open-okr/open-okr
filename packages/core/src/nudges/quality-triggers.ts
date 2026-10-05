/**
 * Seven of the Coach's §6.4 triggers that never fired (completeness review
 * H-11): `quality.sandbagging_draft`, `quality.trending_off`,
 * `quality.too_many_objectives`, `quality.no_not_doing`, `quality.no_cuts`,
 * `quality.sandbagging_close` and `quality.process_health_low`.
 *
 * Readers only. The decisions are `packages/method`'s, from the workflow the
 * cycle screen computes and from `trigger-conditions.ts`, and every number is
 * a §11 parameter. Like the rest of the Coach's nudges, a standing condition
 * repeats with the nightly sweep under §6.3's weekly ceiling, which is what
 * bounds a standing complaint; the review's finding fires once, the night
 * after the review closes.
 */
import {
  activeOnly,
  cycles,
  goals,
  keyResults,
  okrSessions,
  processHealthResponses,
  spaces,
  type WorkspaceTx,
} from "@openokr/db";
import {
  closeIsSandbagged,
  draftIsSandbagged,
  isTriggerKey,
  objectivesOverCap,
  type ResolvedThresholds,
  type TriggerKey,
} from "@openokr/method";
import { and, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import {
  type AgentScope,
  agentSeesGoal,
  agentSeesSession,
} from "../agents/scope.ts";
import { evaluateWorkflow, loadCycleForWorkflow } from "../cycles/workflow.ts";
import { OperationError } from "../operations/errors.ts";
import { localDateOf } from "../sessions/booking.ts";
import type { DueNudge } from "./service.ts";

/** One quality nudge, with the rule key refused before the row exists. */
function qualityNudge(input: {
  readonly ruleKey: TriggerKey;
  readonly subjectType: DueNudge["subjectType"];
  readonly subjectId: string;
  readonly recipientMemberId: string;
}): DueNudge {
  if (!isTriggerKey(input.ruleKey)) {
    throw new OperationError(
      "forbidden",
      `\`${input.ruleKey}\` is not a rule the method package defines.`,
    );
  }
  return {
    ruleKey: input.ruleKey,
    kind: "quality",
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    recipientMemberId: input.recipientMemberId,
    channel: "in_app",
    // None of §6.4's quality triggers escalates, and none is urgent: each one
    // repeats while the set reads the way it does, and the ceiling bounds it.
    escalationStep: 0,
    urgent: false,
  };
}

const present = (ids: readonly (string | null)[]): string[] => [
  ...new Set(ids.filter((id): id is string => id !== null)),
];

/**
 * The two per-objective triggers: a draft whose confidence is too
 * comfortable, and a key result whose forecast misses its target.
 *
 * `quality.sandbagging_draft` is about drafting, so it reads objectives in a
 * cycle that has not published yet, and goes to the champion and the cycle's
 * facilitator. `quality.trending_off` reads the forecast the scoring engine
 * stores on every key result, for any open objective, and goes to the
 * champion.
 */
export async function dueObjectiveQualityNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly thresholds: ResolvedThresholds;
    readonly scope?: AgentScope;
  },
): Promise<readonly DueNudge[]> {
  const rows = await tx
    .select({
      goalId: goals.id,
      championId: goals.championId,
      cycleId: goals.cycleId,
      published: cycles.publishedAt,
      facilitatorId: cycles.facilitatorId,
      confidence: keyResults.confidence,
      forecast: keyResults.forecast,
    })
    .from(goals)
    .innerJoin(
      keyResults,
      and(eq(keyResults.goalId, goals.id), isNull(keyResults.deletedAt)),
    )
    .leftJoin(cycles, eq(cycles.id, goals.cycleId))
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, input.workspaceId),
        isNull(goals.closedAt),
        input.scope ? agentSeesGoal(input.scope) : undefined,
      ),
    );

  const byGoal = new Map<string, typeof rows>();
  for (const row of rows) {
    byGoal.set(row.goalId, [...(byGoal.get(row.goalId) ?? []), row]);
  }

  const due: DueNudge[] = [];
  for (const [goalId, keyResultRows] of byGoal) {
    const first = keyResultRows[0];
    if (!first) {
      continue;
    }
    const drafting = first.cycleId !== null && first.published === null;
    if (
      drafting &&
      draftIsSandbagged(
        // Every objective is aspirational until P9-T11b stores the kind.
        keyResultRows.map((row) => ({
          confidence: row.confidence === null ? null : Number(row.confidence),
          kind: "aspirational" as const,
        })),
        input.thresholds,
      )
    ) {
      for (const recipient of present([
        first.championId,
        first.facilitatorId,
      ])) {
        due.push(
          qualityNudge({
            ruleKey: "quality.sandbagging_draft",
            subjectType: "goal",
            subjectId: goalId,
            recipientMemberId: recipient,
          }),
        );
      }
    }
    const offTrack = keyResultRows.some(
      (row) =>
        (row.forecast as { trendingOffTrack?: unknown } | null)
          ?.trendingOffTrack === true,
    );
    if (offTrack && first.championId) {
      due.push(
        qualityNudge({
          ruleKey: "quality.trending_off",
          subjectType: "goal",
          subjectId: goalId,
          recipientMemberId: first.championId,
        }),
      );
    }
  }
  return due;
}

/**
 * The four per-cycle triggers.
 *
 * Three are about planning and read cycles that have not published: too many
 * objectives at a level or in a unit, phase 3 done with no not-doing list,
 * and capacity judged with nothing recorded as cut. The fourth is about the
 * close: an ended cycle, not yet archived, whose scores average above §11's
 * close line.
 */
export async function dueCycleQualityNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly timeZone: string;
    readonly thresholds: ResolvedThresholds;
    readonly scope?: AgentScope;
  },
): Promise<readonly DueNudge[]> {
  const today = localDateOf(input.now, input.timeZone);
  const rows = await tx
    .select({
      id: cycles.id,
      endsOn: cycles.endsOn,
      publishedAt: cycles.publishedAt,
      sponsorId: cycles.sponsorId,
      facilitatorId: cycles.facilitatorId,
    })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, input.workspaceId),
        ne(cycles.status, "closed"),
      ),
    );

  const due: DueNudge[] = [];
  const say = (
    ruleKey: TriggerKey,
    cycleId: string,
    recipients: readonly (string | null)[],
  ) => {
    for (const recipient of present(recipients)) {
      due.push(
        qualityNudge({
          ruleKey,
          subjectType: "cycle",
          subjectId: cycleId,
          recipientMemberId: recipient,
        }),
      );
    }
  };

  for (const row of rows) {
    const cycleGoals = await tx
      .select({
        id: goals.id,
        level: goals.level,
        spaceId: goals.spaceId,
        spaceName: spaces.name,
      })
      .from(goals)
      .leftJoin(spaces, eq(spaces.id, goals.spaceId))
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, input.workspaceId),
          eq(goals.cycleId, row.id),
          input.scope ? agentSeesGoal(input.scope) : undefined,
        ),
      );

    if (row.publishedAt === null) {
      if (
        objectivesOverCap(
          cycleGoals.map((goal) => ({
            level: goal.level,
            unitId: goal.spaceId,
            unitName: goal.spaceName,
          })),
          input.thresholds,
        ).length > 0
      ) {
        say("quality.too_many_objectives", row.id, [row.facilitatorId]);
      }

      const cycle = await loadCycleForWorkflow(tx, input.workspaceId, row.id);
      if (cycle) {
        const { input: workflow, phases } = await evaluateWorkflow(
          tx,
          input.workspaceId,
          cycle,
          input.thresholds,
        );
        const phaseThree = phases.find((phase) => phase.phase === 3);
        const directionSet =
          phaseThree?.state === "pass" || (cycle.phase ?? 0) > 3;
        if (directionSet && !workflow.frame?.notDoingWritten) {
          say("quality.no_not_doing", row.id, [
            row.sponsorId,
            row.facilitatorId,
          ]);
        }
        const capacityJudged =
          (workflow.goals ?? []).some((goal) =>
            goal.keyResults.some((keyResult) => keyResult.capacity !== null),
          ) ||
          (workflow.initiatives ?? []).some(
            (initiative) => initiative.capacity !== null,
          );
        if (capacityJudged && !workflow.hasCapacityNotes) {
          say("quality.no_cuts", row.id, [row.facilitatorId]);
        }
      }
    }

    if (row.endsOn < today && cycleGoals.length > 0) {
      const scored = await tx
        .select({ score: keyResults.score })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, input.workspaceId),
            inArray(
              keyResults.goalId,
              cycleGoals.map((goal) => goal.id),
            ),
            isNotNull(keyResults.score),
          ),
        );
      if (
        closeIsSandbagged(
          // Every objective is aspirational until P9-T11b stores the kind.
          scored.map((keyResult) => ({
            score: Number(keyResult.score),
            kind: "aspirational" as const,
          })),
          input.thresholds,
        )
      ) {
        say("quality.sandbagging_close", row.id, [row.sponsorId]);
      }
    }
  }
  return due;
}

/**
 * `quality.process_health_low`: to the sponsor, after a quarterly review with
 * process-health answers closes (§8.5: "The lowest-scoring statement becomes
 * next cycle's process OKR"). The nightly sweep sees each review once, the
 * night after it closes; which statement is lowest is on the review's own
 * record.
 */
export async function dueProcessHealthNudges(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly now: Date;
    readonly scope?: AgentScope;
  },
): Promise<readonly DueNudge[]> {
  const since = new Date(input.now.getTime() - 86_400_000);
  const reviews = await tx
    .select({
      id: okrSessions.id,
      sponsorId: cycles.sponsorId,
    })
    .from(okrSessions)
    .innerJoin(cycles, eq(cycles.id, okrSessions.cycleId))
    .where(
      activeOnly(
        okrSessions,
        eq(okrSessions.workspaceId, input.workspaceId),
        eq(okrSessions.kind, "quarterly"),
        eq(okrSessions.state, "closed"),
        isNotNull(okrSessions.endedAt),
        gte(okrSessions.endedAt, since),
        isNotNull(cycles.sponsorId),
        input.scope ? agentSeesSession(input.scope) : undefined,
      ),
    );

  const due: DueNudge[] = [];
  for (const review of reviews) {
    const [answered] = await tx
      .select({ id: processHealthResponses.id })
      .from(processHealthResponses)
      .where(
        activeOnly(
          processHealthResponses,
          eq(processHealthResponses.workspaceId, input.workspaceId),
          eq(processHealthResponses.sessionId, review.id),
        ),
      )
      .limit(1);
    if (!answered) {
      continue;
    }
    due.push(
      qualityNudge({
        ruleKey: "quality.process_health_low",
        subjectType: "session",
        subjectId: review.id,
        recipientMemberId: review.sponsorId as string,
      }),
    );
  }
  return due;
}
