/**
 * The rhythm assists (AI-NATIVE-PLAN.md §2.2, P4-T15b-a).
 *
 * Two things, and the first one is not an assist at all.
 *
 * **`sessions.digest` is the deterministic weekly digest, and it did not exist.**
 * P4-T08 stored the digest as five numbers in a `jsonb` column and nothing ever
 * turned them into the thing METHOD.md §7.2 Step 4 describes: "headline average
 * and the change on last week, what is on track, what is at risk with owners,
 * blockers on the 24-hour clock, and the commitment count". So this read
 * assembles all six parts and renders them through `packages/method`. It needs no
 * provider, it is what a provider-off workspace gets, and the assist below is a
 * rewrite of it rather than a replacement for it.
 *
 * The three parts §7.2 asks for that the stored row does not hold, the change on
 * last week, the names of what is at risk, and the blocker clocks, are computed
 * here from rows that were already there. No schema change: the digest row keeps
 * the numbers and the sentences are derived, which is also why an old digest
 * reads correctly after a goal is renamed.
 *
 * **A narrated number the product did not compute is refused, not trusted.**
 * Both assists here check the model's prose against the numbers the product gave
 * it and drop the narration when it contains one it invented. That is the
 * strongest guarantee available for a narration: it cannot be made to say
 * anything about a figure nobody measured.
 */
import {
  activeOnly,
  blockers,
  digests,
  goals,
  okrSessions,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import {
  type WeeklyDigestInput,
  weeklyDigestLines,
  weeklyDigestNumbers,
} from "@openokr/method";
import { desc, eq, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { RHYTHM_ASSIST_KEYS } from "../ai/assist-keys.ts";
import { checkFeatureAvailability } from "../ai/budgets.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { type ActionCallContext, defineReadAction } from "./define.ts";
import { readKpiDetail } from "./kpis.ts";

/** How many periods a trend narration is given. */
const TREND_PERIODS = 12;

const allowed = async (
  context: ActionCallContext,
  featureKey: string,
): Promise<boolean> =>
  (
    await checkFeatureAvailability(context.pool, {
      workspaceId: context.workspaceId,
      featureKey,
      defaultTier: "balanced",
    })
  ).available;

/**
 * Every number in a piece of prose.
 *
 * Deliberately generous about what counts as a number and strict about what is
 * allowed: a narration is refused when *any* figure in it is one the product did
 * not compute. Being generous here means the check catches more, not less.
 */
const numbersIn = (text: string): number[] =>
  (text.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((match) =>
    Number(match.replace(",", ".")),
  );

/**
 * Whether the prose only states numbers the product handed over.
 *
 * Rounded to one decimal before comparing, because a model writing "41.0" for 41
 * is repeating the number rather than inventing one, and a check that failed on
 * that would be a check nobody could satisfy.
 */
export function statesOnlyKnownNumbers(
  prose: string,
  known: readonly number[],
): boolean {
  const rounded = new Set(known.map((value) => Math.round(value * 10) / 10));
  return numbersIn(prose).every((value) =>
    rounded.has(Math.round(value * 10) / 10),
  );
}

/** The acting member, or not-found. */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

interface DigestBodyNumbers {
  readonly averageConfidence?: number;
  readonly onTrackCount?: number;
  readonly atRiskCount?: number;
  readonly blockerCount?: number;
  readonly commitmentCount?: number;
}

/** Assembles §7.2 Step 4's six parts for one session's digest. */
async function digestInputFor(
  tx: OperationTx,
  workspaceId: string,
  sessionId: string,
): Promise<WeeklyDigestInput | null> {
  const [session] = await tx
    .select({
      id: okrSessions.id,
      spaceId: okrSessions.spaceId,
      digestId: okrSessions.digestId,
    })
    .from(okrSessions)
    .where(
      activeOnly(
        okrSessions,
        eq(okrSessions.workspaceId, workspaceId),
        eq(okrSessions.id, sessionId),
      ),
    )
    .limit(1);
  if (!session?.digestId) {
    // No digest yet. The session has not reached step 4, and saying so with null
    // is truer than rendering a digest of zeroes.
    return null;
  }

  const [row] = await tx
    .select({
      body: digests.body,
      periodStart: digests.periodStart,
      note: digests.note,
      scopeId: digests.scopeId,
    })
    .from(digests)
    .where(
      activeOnly(
        digests,
        eq(digests.workspaceId, workspaceId),
        eq(digests.id, session.digestId),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const body = (row.body ?? {}) as DigestBodyNumbers;

  // Last week's average, for §7.2's "change on last week". The previous digest
  // for the same scope, whatever week it was: a skipped week means the change is
  // against the last week that happened, which is the honest comparison.
  const [previous] = await tx
    .select({ body: digests.body })
    .from(digests)
    .where(
      activeOnly(
        digests,
        eq(digests.workspaceId, workspaceId),
        eq(digests.period, "weekly"),
        eq(digests.scopeId, row.scopeId ?? ""),
        lt(digests.periodStart, row.periodStart),
      ),
    )
    .orderBy(desc(digests.periodStart))
    .limit(1);
  const previousAverage =
    (previous?.body as DigestBodyNumbers | undefined)?.averageConfidence ??
    null;

  // What is at risk, named, with its champion. §7.2 asks for owners and the
  // stored row holds only a count.
  const risky = session.spaceId
    ? await tx
        .select({
          title: goals.title,
          health: goals.health,
          championName: workspaceMembers.name,
        })
        .from(goals)
        .leftJoin(workspaceMembers, eq(workspaceMembers.id, goals.championId))
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.spaceId, session.spaceId),
          ),
        )
    : [];
  const risks = risky
    .filter((goal) => goal.health === "caution" || goal.health === "off_track")
    .map((goal) => ({
      title: goal.title,
      ownerName: goal.championName ?? null,
      status: goal.health,
    }));

  // The blockers and their clocks, from the session that opened them.
  // A blocker has no title of its own: §7.2 diagnoses one into a *type* and a
  // next action, which is what the row holds and what a digest line needs.
  const open = await tx
    .select({
      type: blockers.type,
      nextAction: blockers.nextAction,
      openedAt: blockers.openedAt,
      resolvedAt: blockers.resolvedAt,
      ownerName: workspaceMembers.name,
    })
    .from(blockers)
    .leftJoin(workspaceMembers, eq(workspaceMembers.id, blockers.ownerId))
    .where(
      activeOnly(
        blockers,
        eq(blockers.workspaceId, workspaceId),
        eq(blockers.sessionId, sessionId),
      ),
    );
  const now = Date.now();
  const stillOpen = open
    .filter((blocker) => blocker.resolvedAt === null)
    .map((blocker) => ({
      title: `${blocker.type.replace("_", " ")}: ${blocker.nextAction}`,
      ownerName: blocker.ownerName ?? null,
      ageHours: Math.max(
        0,
        Math.floor((now - blocker.openedAt.getTime()) / 3_600_000),
      ),
    }));

  return {
    spaceName: "This space",
    weekStart: row.periodStart,
    averageConfidence: body.averageConfidence ?? 0,
    previousAverageConfidence: previousAverage,
    onTrackCount: body.onTrackCount ?? 0,
    atRiskCount: body.atRiskCount ?? 0,
    risks,
    blockers: stillOpen,
    commitmentCount: body.commitmentCount ?? 0,
    coordinatorNote: row.note ?? null,
  };
}

/**
 * The weekly digest, in words, with no provider involved.
 *
 * This is the template the acceptance criterion protects. A workspace with no AI
 * gets exactly this, and a workspace with AI gets a rewrite of it that has to say
 * the same numbers.
 */
export const readDigest = defineReadAction({
  name: "sessions.digest",
  summary:
    "The weekly digest for one session, assembled from METHOD.md §7.2 step 4 with no provider involved.",
  input: z.object({ sessionId: z.uuid() }),
  output: z
    .object({
      weekStart: z.string(),
      /** The deterministic digest, one line per §7.2 part. */
      lines: z.array(z.string()),
      /** Every number the digest states, so a narration can be checked. */
      numbers: z.array(z.number()),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: userId ?? "" },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        // The member has to exist and be active before anything is read, which
        // is what makes a suspended member's request answer not-found.
        await actingMember(tx, context.workspaceId, userId);
        const assembled = await digestInputFor(
          tx,
          context.workspaceId,
          input.sessionId,
        );
        if (!assembled) {
          return null;
        }
        return {
          weekStart: assembled.weekStart,
          lines: [...weeklyDigestLines(assembled)],
          numbers: [...weeklyDigestNumbers(assembled)],
        };
      },
    );
  },
});

/**
 * The same digest, rewritten as prose.
 *
 * Null with the provider off, which leaves `sessions.digest`'s own lines as the
 * digest. Null too when the model states a number the product did not compute:
 * a digest is read by people who will act on it, and one invented figure in it
 * is worse than no prose at all.
 */
export const narrateDigest = defineReadAction({
  name: "sessions.narrateDigest",
  summary:
    "Rewrites the weekly digest as prose, refusing any narration that states a number the product did not compute.",
  input: z.object({ sessionId: z.uuid() }),
  output: z
    .object({
      narrative: z.string(),
      /** The deterministic lines, always, so the surface can show both. */
      lines: z.array(z.string()),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.narrateDigest) {
      return null;
    }
    if (!(await allowed(context, RHYTHM_ASSIST_KEYS.narrateDigest))) {
      return null;
    }
    const deterministic = await readDigest.handler(context, input);
    if (!deterministic) {
      return null;
    }

    let narrative: string | null = null;
    try {
      narrative = await drafter.narrateDigest({
        lines: deterministic.lines,
      });
    } catch {
      return null;
    }
    if (!narrative || narrative.trim() === "") {
      return null;
    }
    if (!statesOnlyKnownNumbers(narrative, deterministic.numbers)) {
      // A figure nobody measured. The lines stand on their own, so there is
      // something to show; what there is not is a made-up number in a digest
      // that goes to leadership.
      return null;
    }

    return { narrative: narrative.trim(), lines: deterministic.lines };
  },
});

/**
 * Narrates a KPI's trend, and calls out what moved unusually.
 *
 * The same refusal as the digest, and the same reason. A trend narration is read
 * next to the chart, so a number in it that the chart does not hold is the one
 * thing that would make the chart untrustworthy.
 */
export const narrateTrend = defineReadAction({
  name: "kpis.narrateTrend",
  summary:
    "Narrates a KPI's trend and its anomalies, refusing any narration that states a number the series does not hold.",
  input: z.object({ kpiId: z.uuid() }),
  output: z
    .object({
      narrative: z.string(),
      /** What was flagged as unusual, in the model's words. */
      anomalies: z.array(z.string()),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const drafter = context.drafter;
    if (!drafter?.narrateTrend) {
      return null;
    }
    if (!(await allowed(context, RHYTHM_ASSIST_KEYS.narrateTrend))) {
      return null;
    }

    // Through the registry's own read, so a KPI this member cannot see answers
    // not-found before a model is told anything about it.
    const detail = await readKpiDetail.handler(context, {
      kpiId: input.kpiId,
      periods: TREND_PERIODS,
    });

    const points = detail.records
      .filter(
        (record): record is typeof record & { actualValue: number } =>
          record.actualValue !== null,
      )
      .map((record) => ({
        period: record.periodStart,
        value: record.actualValue,
        target: record.targetValue,
      }))
      // **Oldest first, because that is what the prompt says it is.**
      // `kpis.detail` returns records newest first, which is right for a table
      // and wrong here: the prompt hands the model a list labelled "oldest
      // first", so an unsorted list would have it read every trend backwards and
      // describe a rise as a fall. Caught by a test asserting the order.
      .sort((left, right) => left.period.localeCompare(right.period));
    if (points.length < 2) {
      // One point is not a trend, and a narration of one would be a sentence
      // about nothing.
      return null;
    }

    // **Every number the model is allowed to state.** The series, the targets,
    // the corridor bounds, and the changes the product itself computes. Anything
    // else in the prose means it was invented.
    const known: number[] = [];
    for (const point of points) {
      known.push(point.value);
      if (point.target !== null) {
        known.push(point.target);
      }
    }
    known.push(detail.kpi.healthyPct, detail.kpi.watchPct);
    if (detail.kpi.achievementPct !== null) {
      known.push(detail.kpi.achievementPct);
    }
    if (detail.kpi.targetDefault !== null) {
      known.push(detail.kpi.targetDefault);
    }
    // The period-to-period changes, and the change across the whole window.
    for (let index = 1; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[index - 1];
      if (current && previous) {
        known.push(
          Math.round((current.value - previous.value) * 100) / 100,
          Math.round((previous.value - current.value) * 100) / 100,
        );
      }
    }
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last) {
      known.push(
        Math.round((last.value - first.value) * 100) / 100,
        Math.round((first.value - last.value) * 100) / 100,
      );
    }
    known.push(points.length);

    let narrated: Awaited<ReturnType<NonNullable<typeof drafter.narrateTrend>>>;
    try {
      narrated = await drafter.narrateTrend({
        title: detail.kpi.title,
        unit: detail.kpi.unit,
        direction: detail.kpi.direction,
        points: points.map((point) => ({
          period: point.period,
          value: point.value,
          target: point.target,
        })),
      });
    } catch {
      return null;
    }
    if (!narrated || narrated.narrative.trim() === "") {
      return null;
    }

    const everything = [narrated.narrative, ...narrated.anomalies].join(" ");
    if (!statesOnlyKnownNumbers(everything, known)) {
      return null;
    }

    return {
      narrative: narrated.narrative.trim(),
      anomalies: narrated.anomalies.map((anomaly) => anomaly.trim()),
    };
  },
});
