/**
 * Session actions (TECHNICAL-PLAN §4, METHOD.md §7.2, P4-T07a).
 *
 * A session is one held ritual: weekly (4 stages), monthly or quarterly
 * (11 stages). Every write goes through the Operation pipeline. Every read
 * goes through the access-aware path: a non-member of the space reads
 * not-found rather than forbidden.
 *
 * Live stage sync: `sessions.advanceStage` returns `realtimeChannel` in its
 * result so the route handler can notify connected clients. The
 * action itself does not import `packages/adapters` (CLAUDE.md boundary rule).
 */
import {
  accessContexts,
  activeOnly,
  BLOCKER_SOURCES,
  BLOCKER_TYPES,
  blockers,
  checkInVotes,
  commitments,
  decisions,
  digests,
  goals,
  keyResultDependencies,
  keyResults,
  kudos,
  OBJECTIVE_TRENDS,
  objectiveTrends,
  reviewNarratives,
  reviewScores,
  SESSION_KINDS,
  SESSION_STATES,
  sessionConfidences,
  sessionParticipants,
  okrSessions as sessions,
  spaceMembers,
  streaks,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import {
  cycleScore,
  objectiveScore,
  portfolioVerdictOf,
  progressSignal,
  REVIEW_STAGE_KEYS,
  roomPulseRead,
  WEEKLY_STAGE_KEYS,
} from "@openokr/method";
import { and, avg, count, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { localDateIn } from "../cycles/generation.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { sessionChannel } from "../sessions/live.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

/**
 * The stage list for a ritual, or null when it holds no stages (P4-T10a-a).
 *
 * One lookup rather than a branch per call site. The weekly and quarterly
 * machines are the same walk over two different lists, and a monthly review
 * has no stages at all: §7.5's agenda is a record the facilitator fills in, not
 * a rail they advance. A `switch` here means adding a fifth ritual is one
 * change rather than a hunt.
 */
function stageKeysFor(kind: string): readonly string[] | null {
  switch (kind) {
    case "weekly":
      return WEEKLY_STAGE_KEYS;
    case "quarterly":
      return REVIEW_STAGE_KEYS;
    default:
      return null;
  }
}

async function requireSessionAccess(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  sessionId: string,
  requires: number,
) {
  const [session] = await tx
    .select()
    .from(sessions)
    .where(
      activeOnly(
        sessions,
        eq(sessions.workspaceId, workspaceId),
        eq(sessions.id, sessionId),
      ),
    )
    .limit(1);

  if (!session) {
    throw new OperationError("not_found", "No such session.");
  }

  if (session.spaceId) {
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "space",
      resourceId: session.spaceId,
      requires: requires as never,
    });
  }

  return session;
}

async function resolveSpaceContextId(
  tx: OperationTx,
  workspaceId: string,
  spaceId: string,
): Promise<string> {
  const [ctx] = await tx
    .select({ id: accessContexts.id })
    .from(accessContexts)
    .where(
      activeOnly(
        accessContexts,
        eq(accessContexts.workspaceId, workspaceId),
        eq(accessContexts.resourceType, "space"),
        eq(accessContexts.resourceId, spaceId),
      ),
    )
    .limit(1);
  if (!ctx) {
    throw new OperationError(
      "not_found",
      "No such space, or you do not have access to it.",
    );
  }
  return ctx.id;
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

const sessionOutput = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  spaceId: z.uuid().nullable(),
  cycleId: z.uuid().nullable(),
  kind: z.enum(SESSION_KINDS),
  title: z.string(),
  scheduledFor: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  facilitatorId: z.uuid(),
  stageKey: z.string().nullable(),
  stageStartedAt: z.string().nullable(),
  elapsed: z.record(z.string(), z.number()),
  /**
   * The facilitator's private per-stage notes, and empty for everybody else.
   *
   * §8.1 calls them private and this is where that is enforced. It was not:
   * `toOutput` returned the whole map to every caller from P4-T07a until
   * P4-T10a-a. Nothing wrote notes in between, so nothing leaked, and the
   * shape was still wrong.
   */
  notes: z.record(z.string(), z.unknown()),
  /** Whole minutes added per stage by the facilitator (METHOD.md §8.1). */
  addedMinutes: z.record(z.string(), z.number()),
  state: z.enum(SESSION_STATES),
  digestId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type SessionOutput = z.infer<typeof sessionOutput>;

/**
 * A session as a caller may see it.
 *
 * `viewerMemberId` decides one field: the facilitator's notes. Every other
 * column is the shared record of the ritual and is the same for everybody in
 * the room.
 */
function toOutput(
  row: typeof sessions.$inferSelect,
  viewerMemberId: string | null,
): SessionOutput {
  const isFacilitator = viewerMemberId === row.facilitatorId;
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    spaceId: row.spaceId ?? null,
    cycleId: row.cycleId ?? null,
    kind: row.kind,
    title: row.title,
    scheduledFor: row.scheduledFor.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    facilitatorId: row.facilitatorId,
    stageKey: row.stageKey ?? null,
    stageStartedAt: row.stageStartedAt?.toISOString() ?? null,
    elapsed: (row.elapsed ?? {}) as Record<string, number>,
    notes: isFacilitator ? ((row.notes ?? {}) as Record<string, unknown>) : {},
    addedMinutes: (row.addedMinutes ?? {}) as Record<string, number>,
    state: row.state,
    digestId: row.digestId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Write actions
// ---------------------------------------------------------------------------

export const createSession = defineWriteAction({
  name: "sessions.create",
  summary: "Creates a scheduled session for a space.",
  input: z.object({
    spaceId: z.uuid(),
    cycleId: z.uuid().optional(),
    kind: z.enum(SESSION_KINDS),
    title: z.string().trim().min(1).max(200),
    scheduledFor: z.string(),
    facilitatorId: z.uuid(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const contextId = await resolveSpaceContextId(
        tx,
        workspaceId,
        input.spaceId,
      );

      await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "space",
        resourceId: input.spaceId,
        requires: ACCESS_LEVELS.edit,
      });

      const id = crypto.randomUUID();
      await tx.insert(sessions).values({
        id,
        workspaceId,
        spaceId: input.spaceId,
        cycleId: input.cycleId ?? null,
        kind: input.kind,
        title: input.title,
        scheduledFor: new Date(input.scheduledFor),
        facilitatorId: input.facilitatorId,
        state: "scheduled",
      });

      return {
        result: { id },
        activity: {
          kind: "session.created",
          subjectType: "space",
          subjectId: input.spaceId,
          contextId,
          payload: { kind: input.kind, title: input.title },
        },
        audit: {
          action: "sessions.create",
          targetType: "session",
          targetId: id,
          payload: { kind: input.kind, spaceId: input.spaceId },
        },
      };
    },
  }),
});

export const openSession = defineWriteAction({
  name: "sessions.open",
  summary:
    "Opens a scheduled session, setting it to running and starting the first stage.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      if (session.state !== "scheduled") {
        throw new OperationError(
          "not_found",
          `Cannot open a session in state '${session.state}'.`,
        );
      }

      const firstStage = stageKeysFor(session.kind)?.[0] ?? null;
      const now = new Date();

      await tx
        .update(sessions)
        .set({
          state: "running",
          startedAt: now,
          stageKey: firstStage ?? null,
          stageStartedAt: now,
          updatedAt: now,
        })
        .where(activeOnly(sessions, eq(sessions.id, input.id)));

      return {
        result: { id: input.id },
        /**
         * Opening is a stage change too (P4-T10a-a).
         *
         * Somebody sitting on a scheduled session is waiting for exactly this
         * moment, and without the row they would wait through the whole review
         * unless they thought to reload. Same topic as the advance, because to
         * a client there is no difference: the stage moved.
         */
        outbox: [
          {
            topic: "session.stageChanged",
            payload: {
              channel: sessionChannel(workspaceId, input.id),
              sessionId: input.id,
              workspaceId,
              from: null,
              to: firstStage,
            },
            idempotencyKey: `session.stageChanged:${input.id}:opened`,
          },
        ],
        activity: {
          kind: "session.opened",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: { kind: session.kind },
        },
        audit: {
          action: "sessions.open",
          targetType: "session",
          targetId: input.id,
        },
      };
    },
  }),
});

export const advanceStage = defineWriteAction({
  name: "sessions.advanceStage",
  summary:
    "Advances a running session to its next stage, recording elapsed time.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), realtimeChannel: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      if (session.state !== "running") {
        throw new OperationError("not_found", "Session is not running.");
      }

      let nextStageKey: string | null = null;
      const stageKeys = stageKeysFor(session.kind);
      if (stageKeys) {
        const stageIndex = session.stageKey
          ? stageKeys.indexOf(session.stageKey)
          : -1;
        if (stageIndex === stageKeys.length - 1) {
          throw new OperationError(
            "not_found",
            "Already on the last stage. Close the session to finish.",
          );
        }
        nextStageKey = stageKeys[stageIndex + 1] ?? null;

        // Stage completion gate: confidence → diagnose requires every KR
        // in the space's active cycle to have a confirmed confidence.
        // **`session.cycleId` is part of the condition, not defaulted inside
        // the query.** `cycle_id` is nullable by design, and this read once
        // passed `session.cycleId ?? ""` into a uuid comparison, which
        // Postgres refuses outright: the whole session screen fell to its
        // error boundary with "We could not load your workspace" for any
        // session created outside a cycle. A gate over the key results in a
        // cycle has nothing to check when there is no cycle, so it does not
        // run rather than running against a placeholder.
        if (
          session.stageKey === "confidence" &&
          nextStageKey === "diagnose" &&
          session.spaceId &&
          session.cycleId
        ) {
          const spaceKrs = await tx
            .select({ id: keyResults.id, title: keyResults.title })
            .from(keyResults)
            .innerJoin(goals, eq(keyResults.goalId, goals.id))
            .where(
              activeOnly(
                keyResults,
                eq(keyResults.workspaceId, workspaceId),
                eq(goals.spaceId, session.spaceId),
                eq(goals.cycleId, session.cycleId),
              ),
            );

          const confirmed = await tx
            .select({ keyResultId: sessionConfidences.keyResultId })
            .from(sessionConfidences)
            .where(
              activeOnly(
                sessionConfidences,
                eq(sessionConfidences.workspaceId, workspaceId),
                eq(sessionConfidences.sessionId, input.id),
              ),
            );

          const confirmedIds = new Set(confirmed.map((c) => c.keyResultId));
          const missing = spaceKrs.filter((kr) => !confirmedIds.has(kr.id));

          if (missing.length > 0) {
            const names = missing.map((kr) => kr.title).join(", ");
            throw new OperationError(
              "not_found",
              `Cannot advance: ${names} has no confirmed confidence.`,
            );
          }
        }

        // Stage completion gate: diagnose → commitments requires every
        // low-confidence KR to have a blocker with type, owner and action.
        if (
          session.stageKey === "diagnose" &&
          nextStageKey === "commitments" &&
          session.spaceId
        ) {
          // Load confirmed confidences for this session.
          const confirmations = await tx
            .select({
              keyResultId: sessionConfidences.keyResultId,
              confidence: sessionConfidences.confirmedConfidence,
            })
            .from(sessionConfidences)
            .where(
              activeOnly(
                sessionConfidences,
                eq(sessionConfidences.workspaceId, workspaceId),
                eq(sessionConfidences.sessionId, input.id),
              ),
            );

          // Find KRs with confidence below the low threshold (0.4 default).
          // The threshold is a §11 parameter; reading it here would require
          // resolving thresholds inside the action. For now, use 0.4 as the
          // hard-coded default — it matches the check constraint the design
          // specifies. METHOD.md says the threshold, not the action, is the
          // authority, and P4-T15 wires the resolved value.
          const LOW_THRESHOLD = 0.4;
          const lowKrIds = confirmations
            .filter((c) => Number(c.confidence) < LOW_THRESHOLD)
            .map((c) => c.keyResultId);

          if (lowKrIds.length > 0) {
            // Check that each low KR has at least one unresolved blocker.
            const existingBlockers = await tx
              .select({ keyResultId: blockers.keyResultId })
              .from(blockers)
              .where(
                activeOnly(
                  blockers,
                  eq(blockers.workspaceId, workspaceId),
                  eq(blockers.sessionId, input.id),
                  isNull(blockers.resolvedAt),
                ),
              );

            const blockedIds = new Set(
              existingBlockers.map((b) => b.keyResultId),
            );
            const unblockedLowKrs = lowKrIds.filter(
              (id) => !blockedIds.has(id),
            );

            if (unblockedLowKrs.length > 0) {
              // Look up names for the error message.
              const krNames = confirmations
                .filter((c) => unblockedLowKrs.includes(c.keyResultId))
                .map((c) => c.keyResultId);

              // Get titles from the key_results table.
              const krRows = await tx
                .select({ id: keyResults.id, title: keyResults.title })
                .from(keyResults)
                .where(
                  activeOnly(
                    keyResults,
                    eq(keyResults.workspaceId, workspaceId),
                  ),
                );

              const titles = unblockedLowKrs
                .map((id) => krRows.find((kr) => kr.id === id)?.title ?? id)
                .join(", ");

              throw new OperationError(
                "not_found",
                `Cannot advance: ${titles} scored below ${LOW_THRESHOLD} and has no blocker.`,
              );
            }
          }
        }

        // Stage completion gate: commitments → digest requires at least 2
        // new commitments for this session (§11 sessions.weeklyCommitmentBounds).
        if (
          session.stageKey === "commitments" &&
          nextStageKey === "digest" &&
          session.spaceId &&
          session.cycleId
        ) {
          // Only enforce commitments when the space has KRs.
          const [krCount] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(keyResults)
            .innerJoin(goals, eq(keyResults.goalId, goals.id))
            .where(
              activeOnly(
                keyResults,
                eq(keyResults.workspaceId, workspaceId),
                eq(goals.spaceId, session.spaceId),
                eq(goals.cycleId, session.cycleId),
              ),
            );

          if ((krCount?.count ?? 0) > 0) {
            const MIN_COMMITMENTS = 2;
            const [commitmentCount] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(commitments)
              .where(
                activeOnly(
                  commitments,
                  eq(commitments.workspaceId, workspaceId),
                  eq(commitments.sessionId, input.id),
                ),
              );
            if ((commitmentCount?.count ?? 0) < MIN_COMMITMENTS) {
              throw new OperationError(
                "not_found",
                `Cannot advance: at least ${MIN_COMMITMENTS} commitments are required, but only ${commitmentCount?.count ?? 0} were set.`,
              );
            }
          }
        }
      }

      const now = new Date();
      const elapsedMs = session.stageStartedAt
        ? now.getTime() - session.stageStartedAt.getTime()
        : 0;
      const elapsedSeconds = Math.round(elapsedMs / 1000);
      const currentElapsed = (session.elapsed ?? {}) as Record<string, number>;
      const updatedElapsed = session.stageKey
        ? { ...currentElapsed, [session.stageKey]: elapsedSeconds }
        : currentElapsed;

      await tx
        .update(sessions)
        .set({
          stageKey: nextStageKey,
          stageStartedAt: now,
          elapsed: updatedElapsed,
          updatedAt: now,
        })
        .where(activeOnly(sessions, eq(sessions.id, input.id)));

      const channel = sessionChannel(workspaceId, input.id);

      return {
        result: { id: input.id, realtimeChannel: channel },
        /**
         * The realtime publish, as an outbox row (P4-T10a-a).
         *
         * **This was missing, and its absence made the live-sync claim false.**
         * The action returned the channel name and nothing ever published to
         * it: `session.stageChanged` was declared in `packages/core/src/
         * sessions/live.ts`, listened for by the client and forwarded by the
         * SSE route, and emitted by no code at all. Every connected client
         * therefore sat on a stale rail until somebody reloaded.
         *
         * A row rather than a driver call, because that is the only way a side
         * effect may leave a write path: the change, the activity, the audit
         * row and this commit together or not at all. It still does not reach
         * anybody, because no relay drains the outbox yet. That gap is recorded
         * in PHASE-4-SPLIT.md and it is now the only thing standing between
         * this write and a live rail.
         *
         * The key carries the stage, so advancing twice enqueues two rows while
         * a retried write of the same advance cannot.
         */
        outbox: [
          {
            topic: "session.stageChanged",
            payload: {
              channel,
              sessionId: input.id,
              workspaceId,
              from: session.stageKey,
              to: nextStageKey,
            },
            idempotencyKey: `session.stageChanged:${input.id}:${nextStageKey ?? "closed"}`,
          },
        ],
        activity: {
          kind: "session.stageAdvanced",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: { from: session.stageKey, to: nextStageKey },
        },
        audit: {
          action: "sessions.advanceStage",
          targetType: "session",
          targetId: input.id,
          payload: { from: session.stageKey, to: nextStageKey },
        },
      };
    },
  }),
});

export const skipSession = defineWriteAction({
  name: "sessions.skip",
  summary: "Marks a scheduled session as skipped.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      if (session.state !== "scheduled") {
        throw new OperationError(
          "not_found",
          `Cannot skip a session in state '${session.state}'.`,
        );
      }

      const now = new Date();
      await tx
        .update(sessions)
        .set({ state: "skipped", updatedAt: now })
        .where(activeOnly(sessions, eq(sessions.id, input.id)));

      // Reset streak on skip (§7.4: a skipped week breaks it).
      if (session.spaceId) {
        const [existing] = await tx
          .select()
          .from(streaks)
          .where(
            and(
              eq(streaks.workspaceId, workspaceId),
              eq(streaks.spaceId, session.spaceId),
            ),
          )
          .limit(1);

        if (existing) {
          // openokr:allow-mutation: streak is derived.
          await tx
            .update(streaks)
            .set({ currentWeeks: 0, updatedAt: now })
            .where(eq(streaks.id, existing.id));
        }
      }

      return {
        result: { id: input.id },
        activity: {
          kind: "session.skipped",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: { kind: session.kind },
        },
        audit: {
          action: "sessions.skip",
          targetType: "session",
          targetId: input.id,
        },
      };
    },
  }),
});

export const closeSession = defineWriteAction({
  name: "sessions.close",
  summary: "Closes a running session.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.id,
        ACCESS_LEVELS.edit,
      );

      if (session.state !== "running") {
        throw new OperationError(
          "not_found",
          "Only a running session can be closed.",
        );
      }

      const now = new Date();

      // Generate digest from session data.
      let digestId: string | null = null;
      if (session.spaceId) {
        const confirmations = await tx
          .select({
            keyResultId: sessionConfidences.keyResultId,
            confidence: sessionConfidences.confirmedConfidence,
          })
          .from(sessionConfidences)
          .where(
            activeOnly(
              sessionConfidences,
              eq(sessionConfidences.workspaceId, workspaceId),
              eq(sessionConfidences.sessionId, input.id),
            ),
          );

        const confidences = confirmations.map((c) => Number(c.confidence));
        const avgConfidence =
          confidences.length > 0
            ? confidences.reduce((s, v) => s + v, 0) / confidences.length
            : 0;

        const HIGH = 0.7;
        const LOW = 0.4;
        const onTrack = confidences.filter((c) => c >= HIGH).length;
        const atRisk = confidences.filter((c) => c < LOW).length;

        const [blockerRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(blockers)
          .where(
            activeOnly(
              blockers,
              eq(blockers.workspaceId, workspaceId),
              eq(blockers.sessionId, input.id),
              isNull(blockers.resolvedAt),
            ),
          );
        const blockerCount = blockerRow?.count ?? 0;

        const [commitmentRow] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(commitments)
          .where(
            activeOnly(
              commitments,
              eq(commitments.workspaceId, workspaceId),
              eq(commitments.sessionId, input.id),
            ),
          );
        const commitmentCount = commitmentRow?.count ?? 0;

        const weekStart = now.toISOString().slice(0, 10);
        digestId = crypto.randomUUID();
        await tx.insert(digests).values({
          id: digestId,
          workspaceId,
          scope: "space",
          scopeId: session.spaceId,
          period: "weekly",
          periodStart: weekStart,
          body: {
            averageConfidence: Math.round(avgConfidence * 100) / 100,
            onTrackCount: onTrack,
            atRiskCount: atRisk,
            blockerCount,
            commitmentCount,
          },
          generatedAt: now,
        });
      }

      // Update streak.
      if (session.spaceId) {
        const weekStart = now.toISOString().slice(0, 10);
        const [existing] = await tx
          .select()
          .from(streaks)
          .where(
            and(
              eq(streaks.workspaceId, workspaceId),
              eq(streaks.spaceId, session.spaceId),
            ),
          )
          .limit(1);

        if (existing) {
          const newCurrent = existing.currentWeeks + 1;
          const newLongest = Math.max(existing.longestWeeks, newCurrent);
          // openokr:allow-mutation: streak is derived, not a domain change.
          await tx
            .update(streaks)
            .set({
              currentWeeks: newCurrent,
              longestWeeks: newLongest,
              lastSessionWeek: weekStart,
              updatedAt: now,
            })
            .where(eq(streaks.id, existing.id));
        } else {
          // openokr:allow-mutation: streak is derived.
          await tx.insert(streaks).values({
            id: crypto.randomUUID(),
            workspaceId,
            spaceId: session.spaceId,
            currentWeeks: 1,
            longestWeeks: 1,
            lastSessionWeek: weekStart,
          });
        }
      }

      /**
       * The review's grades become facts about the key results (P4-T10b-a).
       *
       * §8.3 grades against the key result as written and hides the objective
       * score until the room reveals it, so a score written straight onto
       * `key_results.score` during the stage would be visible on the goal page
       * immediately and would not be revisable while the room talks. Closing is
       * the moment it stops moving, which is the moment it becomes a fact.
       *
       * Only what was graded is written. An ungraded key result keeps whatever
       * it had, because writing zero would be the review claiming a result it
       * never discussed.
       *
       * In this transaction with the close, so a session cannot end with half
       * its scores landed.
       */
      if (session.kind === "quarterly") {
        const graded = await tx
          .select({
            keyResultId: reviewScores.keyResultId,
            score: reviewScores.score,
          })
          .from(reviewScores)
          .where(
            activeOnly(
              reviewScores,
              eq(reviewScores.workspaceId, workspaceId),
              eq(reviewScores.sessionId, input.id),
            ),
          );

        for (const grade of graded) {
          // openokr:allow-mutation: runs on the transaction this Operation
          // opened, so the score, the close, the audit row and the outbox row
          // commit together or not at all.
          await tx
            .update(keyResults)
            .set({ score: grade.score, updatedAt: now })
            .where(
              activeOnly(
                keyResults,
                eq(keyResults.workspaceId, workspaceId),
                eq(keyResults.id, grade.keyResultId),
              ),
            );
        }
      }

      await tx
        .update(sessions)
        .set({
          state: "closed",
          endedAt: now,
          digestId,
          updatedAt: now,
        })
        .where(activeOnly(sessions, eq(sessions.id, input.id)));

      return {
        result: { id: input.id },
        activity: {
          kind: "session.closed",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: { kind: session.kind },
        },
        audit: {
          action: "sessions.close",
          targetType: "session",
          targetId: input.id,
        },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// Read actions
// ---------------------------------------------------------------------------

export const readSession = defineReadAction({
  name: "sessions.read",
  summary: "One session by id. Returns not-found when the caller lacks access.",
  input: z.object({ id: z.uuid() }),
  output: sessionOutput,
  access: ACCESS_LEVELS.view,
  async handler(context, input): Promise<SessionOutput> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);

        if (!member) {
          throw new OperationError("not_found", "No such session.");
        }

        const [row] = await tx
          .select()
          .from(sessions)
          .where(
            activeOnly(
              sessions,
              eq(sessions.workspaceId, context.workspaceId),
              eq(sessions.id, input.id),
            ),
          )
          .limit(1);

        if (!row) {
          throw new OperationError("not_found", "No such session.");
        }

        // Verify the caller is a member of the session's space.
        if (row.spaceId) {
          const [spaceMembership] = await tx
            .select({ memberId: spaceMembers.memberId })
            .from(spaceMembers)
            .where(
              activeOnly(
                spaceMembers,
                eq(spaceMembers.workspaceId, context.workspaceId),
                eq(spaceMembers.spaceId, row.spaceId),
                eq(spaceMembers.memberId, member.id),
              ),
            )
            .limit(1);

          if (!spaceMembership) {
            throw new OperationError("not_found", "No such session.");
          }
        }

        return toOutput(row, member.id);
      },
    );
  },
});

export const listSessions = defineReadAction({
  name: "sessions.list",
  summary: "Sessions for a space, newest first.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.array(sessionOutput),
  access: ACCESS_LEVELS.view,
  async handler(context, input): Promise<SessionOutput[]> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);

        if (!member) {
          return [];
        }

        const rows = await tx
          .select()
          .from(sessions)
          .where(
            activeOnly(
              sessions,
              eq(sessions.workspaceId, context.workspaceId),
              eq(sessions.spaceId, input.spaceId),
            ),
          )
          .orderBy(desc(sessions.scheduledFor));

        return rows.map((row) => toOutput(row, member.id));
      },
    );
  },
});

export const listParticipants = defineReadAction({
  name: "sessions.participants",
  summary: "Active space members for a session's space.",
  input: z.object({ id: z.uuid() }),
  output: z.array(
    z.object({
      memberId: z.uuid(),
      name: z.string(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(
    context,
    input,
  ): Promise<Array<{ memberId: string; name: string }>> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [session] = await tx
          .select({ spaceId: sessions.spaceId })
          .from(sessions)
          .where(
            activeOnly(
              sessions,
              eq(sessions.workspaceId, context.workspaceId),
              eq(sessions.id, input.id),
            ),
          )
          .limit(1);

        if (!session?.spaceId) {
          return [];
        }

        const members = await tx
          .select({
            memberId: spaceMembers.memberId,
            name: workspaceMembers.name,
          })
          .from(spaceMembers)
          .innerJoin(
            workspaceMembers,
            and(
              eq(spaceMembers.memberId, workspaceMembers.id),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .where(
            activeOnly(
              spaceMembers,
              eq(spaceMembers.workspaceId, context.workspaceId),
              eq(spaceMembers.spaceId, session.spaceId),
            ),
          );

        return members.map((m) => ({
          memberId: m.memberId,
          name: m.name,
        }));
      },
    );
  },
});

// ---------------------------------------------------------------------------
// P4-T07b: Confidence round actions
// ---------------------------------------------------------------------------

export const castSessionVote = defineWriteAction({
  name: "sessions.castVote",
  summary:
    "A private confidence vote on one key result within a session. Upserts: a second vote replaces the first.",
  input: z.object({
    sessionId: z.uuid(),
    keyResultId: z.uuid(),
    confidence: z.number().min(0).max(1),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      // Verify the KR exists.
      const [kr] = await tx
        .select({ id: keyResults.id, goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.keyResultId),
          ),
        )
        .limit(1);
      if (!kr) {
        throw new OperationError("not_found", "No such key result.");
      }

      // Upsert: update existing unrevealed vote, or insert.
      const [existing] = await tx
        .select({ id: checkInVotes.id })
        .from(checkInVotes)
        .where(
          activeOnly(
            checkInVotes,
            eq(checkInVotes.workspaceId, workspaceId),
            eq(checkInVotes.sessionId, input.sessionId),
            eq(checkInVotes.keyResultId, input.keyResultId),
            eq(checkInVotes.memberId, memberId),
            isNull(checkInVotes.revealedAt),
          ),
        )
        .limit(1);

      let voteId: string;
      if (existing) {
        await tx
          .update(checkInVotes)
          .set({
            confidence: String(input.confidence),
            updatedAt: new Date(),
          })
          .where(activeOnly(checkInVotes, eq(checkInVotes.id, existing.id)));
        voteId = existing.id;
      } else {
        voteId = crypto.randomUUID();
        await tx.insert(checkInVotes).values({
          id: voteId,
          workspaceId,
          sessionId: input.sessionId,
          keyResultId: input.keyResultId,
          memberId,
          confidence: String(input.confidence),
        });
      }

      return {
        result: { id: voteId },
        activity: {
          kind: "session.voteCast",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: { keyResultId: input.keyResultId },
        },
        audit: {
          action: "sessions.castVote",
          targetType: "check_in_vote",
          targetId: voteId,
          payload: { keyResultId: input.keyResultId },
        },
      };
    },
  }),
});

export const revealSessionVotes = defineWriteAction({
  name: "sessions.revealVotes",
  summary: "Reveals every vote on a key result in one session, atomically.",
  input: z.object({
    sessionId: z.uuid(),
    keyResultId: z.uuid(),
  }),
  output: z.object({ revealed: z.number().int() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      const now = new Date();
      const revealed = await tx
        .update(checkInVotes)
        .set({ revealedAt: now, updatedAt: now })
        .where(
          activeOnly(
            checkInVotes,
            eq(checkInVotes.workspaceId, workspaceId),
            eq(checkInVotes.sessionId, input.sessionId),
            eq(checkInVotes.keyResultId, input.keyResultId),
            isNull(checkInVotes.revealedAt),
          ),
        )
        .returning({ id: checkInVotes.id });

      return {
        result: { revealed: revealed.length },
        activity: {
          kind: "session.votesRevealed",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: {
            keyResultId: input.keyResultId,
            count: revealed.length,
          },
        },
        audit: {
          action: "sessions.revealVotes",
          targetType: "session",
          targetId: input.sessionId,
          payload: {
            keyResultId: input.keyResultId,
            count: revealed.length,
          },
        },
      };
    },
  }),
});

export const confirmSessionConfidence = defineWriteAction({
  name: "sessions.confirmConfidence",
  summary:
    "The champion confirms the final confidence and writes the what-changed note.",
  input: z.object({
    sessionId: z.uuid(),
    keyResultId: z.uuid(),
    confidence: z.number().min(0).max(1),
    whatChanged: z.string().trim().min(1).max(500),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      // Compute the team average from revealed votes.
      const [avgRow] = await tx
        .select({
          avg: sql<string>`avg(${checkInVotes.confidence})`,
        })
        .from(checkInVotes)
        .where(
          activeOnly(
            checkInVotes,
            eq(checkInVotes.workspaceId, workspaceId),
            eq(checkInVotes.sessionId, input.sessionId),
            eq(checkInVotes.keyResultId, input.keyResultId),
          ),
        );
      const teamAverage = avgRow?.avg
        ? String(Number(avgRow.avg).toFixed(2))
        : null;

      // Upsert the confirmed confidence.
      const [existing] = await tx
        .select({ id: sessionConfidences.id })
        .from(sessionConfidences)
        .where(
          activeOnly(
            sessionConfidences,
            eq(sessionConfidences.workspaceId, workspaceId),
            eq(sessionConfidences.sessionId, input.sessionId),
            eq(sessionConfidences.keyResultId, input.keyResultId),
          ),
        )
        .limit(1);

      let confirmId: string;
      if (existing) {
        await tx
          .update(sessionConfidences)
          .set({
            confirmedConfidence: String(input.confidence),
            teamAverage,
            whatChanged: input.whatChanged,
            confirmedById: memberId,
            updatedAt: new Date(),
          })
          .where(
            activeOnly(
              sessionConfidences,
              eq(sessionConfidences.id, existing.id),
            ),
          );
        confirmId = existing.id;
      } else {
        confirmId = crypto.randomUUID();
        await tx.insert(sessionConfidences).values({
          id: confirmId,
          workspaceId,
          sessionId: input.sessionId,
          keyResultId: input.keyResultId,
          confirmedConfidence: String(input.confidence),
          teamAverage,
          whatChanged: input.whatChanged,
          confirmedById: memberId,
        });
      }

      // Update the KR's confidence on the key_results table.
      await tx
        .update(keyResults)
        .set({
          confidence: String(input.confidence),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.keyResultId),
          ),
        );

      return {
        result: { id: confirmId },
        activity: {
          kind: "session.confidenceConfirmed",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: {
            keyResultId: input.keyResultId,
            confidence: input.confidence,
          },
        },
        audit: {
          action: "sessions.confirmConfidence",
          targetType: "session_confidence",
          targetId: confirmId,
          payload: {
            keyResultId: input.keyResultId,
            confidence: input.confidence,
          },
        },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// P4-T07b: Confidence round read actions
// ---------------------------------------------------------------------------

export const sessionVotes = defineReadAction({
  name: "sessions.votes",
  summary:
    "Votes for one KR in a session. Before reveal: own vote only. After reveal: all.",
  input: z.object({
    sessionId: z.uuid(),
    keyResultId: z.uuid(),
  }),
  output: z.array(
    z.object({
      id: z.uuid(),
      memberId: z.uuid(),
      confidence: z.number(),
      revealedAt: z.string().nullable(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(
    context,
    input,
  ): Promise<
    Array<{
      id: string;
      memberId: string;
      confidence: number;
      revealedAt: string | null;
    }>
  > {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const [member] = await tx
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.userId, userId),
              eq(workspaceMembers.status, "active"),
            ),
          )
          .limit(1);

        if (!member) {
          throw new OperationError("not_found", "No such session.");
        }

        // Check if votes are revealed.
        const allVotes = await tx
          .select({
            id: checkInVotes.id,
            memberId: checkInVotes.memberId,
            confidence: checkInVotes.confidence,
            revealedAt: checkInVotes.revealedAt,
          })
          .from(checkInVotes)
          .where(
            activeOnly(
              checkInVotes,
              eq(checkInVotes.workspaceId, context.workspaceId),
              eq(checkInVotes.sessionId, input.sessionId),
              eq(checkInVotes.keyResultId, input.keyResultId),
            ),
          );

        // If any vote is revealed, all should be (atomic reveal). Show all.
        const anyRevealed = allVotes.some((v) => v.revealedAt !== null);

        const visible = anyRevealed
          ? allVotes
          : allVotes.filter((v) => v.memberId === member.id);

        return visible.map((v) => ({
          id: v.id,
          memberId: v.memberId,
          confidence: Number(v.confidence),
          revealedAt: v.revealedAt?.toISOString() ?? null,
        }));
      },
    );
  },
});

export const sessionConfidenceStatus = defineReadAction({
  name: "sessions.confidenceStatus",
  summary: "Which KRs are confirmed vs unconfirmed in this session.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.array(
    z.object({
      keyResultId: z.uuid(),
      title: z.string(),
      confirmed: z.boolean(),
      confirmedConfidence: z.number().nullable(),
      whatChanged: z.string().nullable(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(
    context,
    input,
  ): Promise<
    Array<{
      keyResultId: string;
      title: string;
      confirmed: boolean;
      confirmedConfidence: number | null;
      whatChanged: string | null;
    }>
  > {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        // Read the session to get the space and cycle.
        const [session] = await tx
          .select({
            spaceId: sessions.spaceId,
            cycleId: sessions.cycleId,
          })
          .from(sessions)
          .where(
            activeOnly(
              sessions,
              eq(sessions.workspaceId, context.workspaceId),
              eq(sessions.id, input.sessionId),
            ),
          )
          .limit(1);

        if (!session?.spaceId || !session.cycleId) {
          return [];
        }

        // All KRs in the space's cycle.
        const krs = await tx
          .select({ id: keyResults.id, title: keyResults.title })
          .from(keyResults)
          .innerJoin(goals, eq(keyResults.goalId, goals.id))
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              eq(goals.spaceId, session.spaceId),
              eq(goals.cycleId, session.cycleId),
            ),
          );

        // Confirmed ones.
        const confirmed = await tx
          .select({
            keyResultId: sessionConfidences.keyResultId,
            confirmedConfidence: sessionConfidences.confirmedConfidence,
            whatChanged: sessionConfidences.whatChanged,
          })
          .from(sessionConfidences)
          .where(
            activeOnly(
              sessionConfidences,
              eq(sessionConfidences.workspaceId, context.workspaceId),
              eq(sessionConfidences.sessionId, input.sessionId),
            ),
          );

        const confirmedMap = new Map(confirmed.map((c) => [c.keyResultId, c]));

        return krs.map((kr) => {
          const c = confirmedMap.get(kr.id);
          return {
            keyResultId: kr.id,
            title: kr.title,
            confirmed: !!c,
            confirmedConfidence: c ? Number(c.confirmedConfidence) : null,
            whatChanged: c?.whatChanged ?? null,
          };
        });
      },
    );
  },
});

// ---------------------------------------------------------------------------
// P4-T07c: Blocker actions
// ---------------------------------------------------------------------------

export const createSessionBlocker = defineWriteAction({
  name: "sessions.createBlocker",
  summary:
    "Opens a blocker for a low-confidence KR during the diagnose step. The 24-hour clock starts on save.",
  input: z.object({
    sessionId: z.uuid(),
    keyResultId: z.uuid(),
    type: z.enum(BLOCKER_TYPES),
    description: z.string().max(500).optional(),
    ownerId: z.uuid(),
    nextAction: z.string().trim().min(1).max(500),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      const now = new Date();
      // 24-hour clock from §11 cadence.blockerClockHours (default 24).
      const BLOCKER_CLOCK_HOURS = 24;
      const dueAt = new Date(
        now.getTime() + BLOCKER_CLOCK_HOURS * 60 * 60 * 1000,
      );

      const id = crypto.randomUUID();
      await tx.insert(blockers).values({
        id,
        workspaceId,
        keyResultId: input.keyResultId,
        sessionId: input.sessionId,
        type: input.type,
        description: input.description ?? null,
        ownerId: input.ownerId,
        nextAction: input.nextAction,
        openedAt: now,
        dueAt,
        source: "session",
      });

      return {
        result: { id },
        activity: {
          kind: "session.blockerCreated",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: {
            keyResultId: input.keyResultId,
            type: input.type,
          },
        },
        audit: {
          action: "sessions.createBlocker",
          targetType: "blocker",
          targetId: id,
          payload: {
            keyResultId: input.keyResultId,
            type: input.type,
            ownerId: input.ownerId,
          },
        },
      };
    },
  }),
});

export const resolveSessionBlocker = defineWriteAction({
  name: "sessions.resolveBlocker",
  summary: "Marks a blocker as resolved.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const [blocker] = await tx
        .select()
        .from(blockers)
        .where(
          activeOnly(
            blockers,
            eq(blockers.workspaceId, workspaceId),
            eq(blockers.id, input.id),
          ),
        )
        .limit(1);

      if (!blocker) {
        throw new OperationError("not_found", "No such blocker.");
      }

      await tx
        .update(blockers)
        .set({ resolvedAt: new Date(), updatedAt: new Date() })
        .where(activeOnly(blockers, eq(blockers.id, input.id)));

      return {
        result: { id: input.id },
        activity: {
          kind: "session.blockerResolved",
          subjectType: "space",
          subjectId: workspaceId,
          payload: { type: blocker.type },
        },
        audit: {
          action: "sessions.resolveBlocker",
          targetType: "blocker",
          targetId: input.id,
        },
      };
    },
  }),
});

export const sessionBlockerStatus = defineReadAction({
  name: "sessions.blockerStatus",
  summary: "Blockers for a session, with aging information.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.array(
    z.object({
      id: z.uuid(),
      keyResultId: z.uuid().nullable(),
      type: z.enum(BLOCKER_TYPES),
      description: z.string().nullable(),
      ownerId: z.uuid(),
      nextAction: z.string(),
      openedAt: z.string(),
      dueAt: z.string(),
      resolvedAt: z.string().nullable(),
      hoursOpen: z.number(),
      overdue: z.boolean(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(
    context,
    input,
  ): Promise<
    Array<{
      id: string;
      keyResultId: string | null;
      type: (typeof BLOCKER_TYPES)[number];
      description: string | null;
      ownerId: string;
      nextAction: string;
      openedAt: string;
      dueAt: string;
      resolvedAt: string | null;
      hoursOpen: number;
      overdue: boolean;
    }>
  > {
    const db = drizzle(context.pool);
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId: context.actor.userId ?? "" },
      async (tx) => {
        const rows = await tx
          .select()
          .from(blockers)
          .where(
            activeOnly(
              blockers,
              eq(blockers.workspaceId, context.workspaceId),
              eq(blockers.sessionId, input.sessionId),
            ),
          );

        const now = new Date();
        return rows.map((b) => {
          const hoursOpen =
            (now.getTime() - b.openedAt.getTime()) / (1000 * 60 * 60);
          return {
            id: b.id,
            keyResultId: b.keyResultId ?? null,
            type: b.type,
            description: b.description ?? null,
            ownerId: b.ownerId,
            nextAction: b.nextAction,
            openedAt: b.openedAt.toISOString(),
            dueAt: b.dueAt.toISOString(),
            resolvedAt: b.resolvedAt?.toISOString() ?? null,
            hoursOpen: Math.round(hoursOpen * 10) / 10,
            overdue: now > b.dueAt && !b.resolvedAt,
          };
        });
      },
    );
  },
});

// ---------------------------------------------------------------------------
// P4-T08: Commitment actions
// ---------------------------------------------------------------------------

export const setSessionCommitments = defineWriteAction({
  name: "sessions.setCommitments",
  summary:
    "Sets this week's commitments (2-3 actions, each with owner and optional KR link).",
  input: z.object({
    sessionId: z.uuid(),
    items: z.array(
      z.object({
        text: z.string().trim().min(1).max(500),
        ownerId: z.uuid(),
        keyResultId: z.uuid().optional(),
      }),
    ),
  }),
  output: z.object({ count: z.number().int() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      if (!session.spaceId) {
        throw new OperationError("not_found", "Session has no space.");
      }

      const weekStart = new Date().toISOString().slice(0, 10);

      for (const item of input.items) {
        await tx.insert(commitments).values({
          id: crypto.randomUUID(),
          workspaceId,
          sessionId: input.sessionId,
          spaceId: session.spaceId,
          weekStart,
          text: item.text,
          ownerId: item.ownerId,
          keyResultId: item.keyResultId ?? null,
        });
      }

      return {
        result: { count: input.items.length },
        activity: {
          kind: "session.commitmentsSet",
          subjectType: "space",
          subjectId: session.spaceId,
          payload: { count: input.items.length },
        },
        audit: {
          action: "sessions.setCommitments",
          targetType: "session",
          targetId: input.sessionId,
          payload: { count: input.items.length },
        },
      };
    },
  }),
});

export const closeSessionCommitments = defineWriteAction({
  name: "sessions.closeCommitments",
  summary:
    "Closes last week's commitments with a delivered/not-delivered verdict.",
  input: z.object({
    items: z.array(
      z.object({
        id: z.uuid(),
        delivered: z.boolean(),
      }),
    ),
  }),
  output: z.object({ closed: z.number().int() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const now = new Date();
      for (const item of input.items) {
        await tx
          .update(commitments)
          .set({
            delivered: item.delivered,
            closedAt: now,
            updatedAt: now,
          })
          .where(
            activeOnly(
              commitments,
              eq(commitments.workspaceId, workspaceId),
              eq(commitments.id, item.id),
            ),
          );
      }

      return {
        result: { closed: input.items.length },
        activity: {
          kind: "session.commitmentsClosed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { count: input.items.length },
        },
        audit: {
          action: "sessions.closeCommitments",
          targetType: "commitment",
          payload: { count: input.items.length },
        },
      };
    },
  }),
});

export const listSessionCommitments = defineReadAction({
  name: "sessions.listCommitments",
  summary: "Commitments for a session.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      ownerId: z.uuid(),
      keyResultId: z.uuid().nullable(),
      delivered: z.boolean().nullable(),
      closedAt: z.string().nullable(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(
    context,
    input,
  ): Promise<
    Array<{
      id: string;
      text: string;
      ownerId: string;
      keyResultId: string | null;
      delivered: boolean | null;
      closedAt: string | null;
    }>
  > {
    const db = drizzle(context.pool);
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId: context.actor.userId ?? "" },
      async (tx) => {
        const rows = await tx
          .select()
          .from(commitments)
          .where(
            activeOnly(
              commitments,
              eq(commitments.workspaceId, context.workspaceId),
              eq(commitments.sessionId, input.sessionId),
            ),
          );

        return rows.map((r) => ({
          id: r.id,
          text: r.text,
          ownerId: r.ownerId,
          keyResultId: r.keyResultId ?? null,
          delivered: r.delivered ?? null,
          closedAt: r.closedAt?.toISOString() ?? null,
        }));
      },
    );
  },
});

export const setCoordinatorNote = defineWriteAction({
  name: "sessions.setCoordinatorNote",
  summary: "Adds the coordinator's note to the session digest.",
  input: z.object({
    sessionId: z.uuid(),
    note: z.string().trim().min(1).max(2000),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      if (!session.digestId) {
        throw new OperationError(
          "not_found",
          "No digest exists for this session yet.",
        );
      }

      await tx
        .update(digests)
        .set({ note: input.note, updatedAt: new Date() })
        .where(activeOnly(digests, eq(digests.id, session.digestId)));

      return {
        result: { id: session.digestId },
        activity: {
          kind: "session.coordinatorNoteSet",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          payload: {},
        },
        audit: {
          action: "sessions.setCoordinatorNote",
          targetType: "digest",
          targetId: session.digestId,
        },
      };
    },
  }),
});

export const readStreak = defineReadAction({
  name: "sessions.readStreak",
  summary: "The rhythm streak for a space.",
  input: z.object({ spaceId: z.uuid() }),
  output: z.object({
    currentWeeks: z.number().int(),
    longestWeeks: z.number().int(),
    lastSessionWeek: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(
    context,
    input,
  ): Promise<{
    currentWeeks: number;
    longestWeeks: number;
    lastSessionWeek: string | null;
  }> {
    const db = drizzle(context.pool);
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId: context.actor.userId ?? "" },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(streaks)
          .where(
            and(
              eq(streaks.workspaceId, context.workspaceId),
              eq(streaks.spaceId, input.spaceId),
            ),
          )
          .limit(1);

        return {
          currentWeeks: row?.currentWeeks ?? 0,
          longestWeeks: row?.longestWeeks ?? 0,
          lastSessionWeek: row?.lastSessionWeek ?? null,
        };
      },
    );
  },
});

// ---------------------------------------------------------------------------
// The monthly review (METHOD.md §7.5, P4-T09)
// ---------------------------------------------------------------------------

/**
 * A monthly review has no stages, so nothing here advances one.
 *
 * §7.5 records four things and this module stores two of them. The dependency
 * and risk log is a read of P3-T09's alignment register, returned by
 * `sessions.monthlyRecord` rather than copied into a table of its own, because
 * two copies of one dependency is two answers a facilitator has to reconcile.
 */
/**
 * `2026-03-14` from an instant, as the workspace's own timezone sees it.
 *
 * **Not `toISOString().slice(0, 10)`.** That answers in UTC, so a review held
 * at six in the morning in Jakarta is recorded on the previous day, and on the
 * first of a month it lands in the wrong month entirely. `localDateIn` is the
 * shared answer the cycle engine already uses, and it is the only thing that
 * knows what the offset was on that particular date.
 */
function localDate(value: Date | string, timeZone: string): string {
  const at = typeof value === "string" ? new Date(value) : value;
  const { year, month, day } = localDateIn(at, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The first day of the month a review covers, in the workspace's timezone.
 *
 * A trend is keyed on the month rather than the meeting (TECHNICAL-PLAN §4.7),
 * so a rescheduled review still records one opinion for the month it is about.
 */
function firstOfMonth(value: Date | string, timeZone: string): string {
  return `${localDate(value, timeZone).slice(0, 7)}-01`;
}

async function requireMonthly(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  sessionId: string,
  requires: number,
) {
  const session = await requireSessionAccess(
    tx,
    workspaceId,
    memberId,
    sessionId,
    requires,
  );
  if (session.kind !== "monthly") {
    throw new OperationError(
      "not_found",
      "Trends and decisions belong to a monthly review.",
    );
  }
  return session;
}

export const setTrend = defineWriteAction({
  name: "sessions.setTrend",
  summary:
    "Records the room's trend for one objective in a monthly review (METHOD.md §7.5).",
  input: z.object({
    sessionId: z.uuid(),
    goalId: z.uuid(),
    trend: z.enum(OBJECTIVE_TRENDS),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireMonthly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );
      // The objective is authorised on its own terms as well. Holding the
      // space does not automatically mean holding a goal parked inside it.
      const goalAccess = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: input.goalId,
        requires: ACCESS_LEVELS.view as never,
      });

      const timeZone = await workspaceTimeZone(tx, workspaceId);
      const month = firstOfMonth(session.scheduledFor, timeZone);
      const [existing] = await tx
        .select({ id: objectiveTrends.id })
        .from(objectiveTrends)
        .where(
          activeOnly(
            objectiveTrends,
            eq(objectiveTrends.workspaceId, workspaceId),
            eq(objectiveTrends.goalId, input.goalId),
            eq(objectiveTrends.month, month),
          ),
        )
        .limit(1);

      // One opinion per objective per month. Recording again corrects it,
      // which is what a room does when it talks itself round, and it is why
      // the row is keyed on the month rather than on the meeting.
      const [row] = existing
        ? await tx
            .update(objectiveTrends)
            .set({
              trend: input.trend,
              authorMemberId: memberId,
              updatedAt: new Date(),
            })
            .where(
              activeOnly(objectiveTrends, eq(objectiveTrends.id, existing.id)),
            )
            .returning({ id: objectiveTrends.id })
        : await tx
            .insert(objectiveTrends)
            .values({
              workspaceId,
              goalId: input.goalId,
              month,
              trend: input.trend,
              authorMemberId: memberId,
            })
            .returning({ id: objectiveTrends.id });

      if (!row) {
        throw new OperationError(
          "not_found",
          "The trend could not be recorded.",
        );
      }

      return {
        result: { id: row.id },
        activity: {
          kind: "session.trendRecorded",
          subjectType: "goal",
          subjectId: input.goalId,
          contextId: goalAccess.contextId,
          payload: { trend: input.trend, sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.setTrend",
          targetType: "session_trend",
          targetId: row.id,
        },
      };
    },
  }),
});

export const setShifts = defineWriteAction({
  name: "sessions.setShifts",
  summary:
    "Records the resource or priority shifts noted in a monthly review (METHOD.md §7.5).",
  input: z.object({
    sessionId: z.uuid(),
    shifts: z.string().trim().max(4000),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireMonthly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      // Empty is a real answer and means the room noted no shift, so the
      // column goes back to null rather than holding an empty string that
      // reads on screen as somebody having written nothing.
      await tx
        .update(sessions)
        .set({
          shifts: input.shifts.length === 0 ? null : input.shifts,
          updatedAt: new Date(),
        })
        .where(activeOnly(sessions, eq(sessions.id, input.sessionId)));

      return {
        result: { id: input.sessionId },
        activity: {
          kind: "session.shiftsRecorded",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          contextId: session.spaceId
            ? await resolveSpaceContextId(tx, workspaceId, session.spaceId)
            : undefined,
          payload: { sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.setShifts",
          targetType: "session",
          targetId: input.sessionId,
        },
      };
    },
  }),
});

export const recordDecision = defineWriteAction({
  name: "sessions.recordDecision",
  summary:
    "Records a decision against the key result or goal it affects (METHOD.md §7.5).",
  input: z
    .object({
      sessionId: z.uuid(),
      goalId: z.uuid().optional(),
      keyResultId: z.uuid().optional(),
      text: z.string().trim().min(1).max(2000),
    })
    // §7.5: "Every decision names the key result it affects." A decision with
    // no subject is a meeting note, and the log is not a notepad. Refused at
    // the boundary as well as by the table constraint, so a caller gets a
    // sentence rather than a database error.
    .refine(
      (value) => value.goalId !== undefined || value.keyResultId !== undefined,
      { message: "A decision names the key result or the goal it affects." },
    ),
  output: z.object({
    id: z.uuid(),
    /**
     * The goal the decision landed on, whichever end named it.
     *
     * Returned so a caller can revalidate that goal's own path rather than the
     * `/goals/[id]` route pattern, and so a surface can link straight to it.
     */
    goalId: z.uuid(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireMonthly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      // The goal the decision lands on, whichever end named it. A key result
      // is authorised through its objective, which is where access lives, and
      // storing both ends is what lets the goal page find it with one index.
      let goalId = input.goalId ?? null;
      if (input.keyResultId) {
        const [owner] = await tx
          .select({ goalId: keyResults.goalId })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, workspaceId),
              eq(keyResults.id, input.keyResultId),
            ),
          )
          .limit(1);
        if (!owner) {
          throw new OperationError("not_found", "No such key result.");
        }
        goalId = goalId ?? owner.goalId;
      }

      // The refine on the input already refuses a decision naming neither, so
      // by here there is always a goal to authorise against.
      if (!goalId) {
        throw new OperationError(
          "not_found",
          "A decision names the key result or the goal it affects.",
        );
      }
      const { contextId: decisionContextId } = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: goalId,
        requires: ACCESS_LEVELS.view as never,
      });

      const [row] = await tx
        .insert(decisions)
        .values({
          workspaceId,
          // Stamped now rather than derived later: `goals.moveToCycle` would
          // otherwise rewrite which cycle decided this.
          cycleId: session.cycleId,
          sessionId: input.sessionId,
          goalId,
          keyResultId: input.keyResultId ?? null,
          text: input.text,
          at: localDate(new Date(), await workspaceTimeZone(tx, workspaceId)),
          authorMemberId: memberId,
        })
        .returning({ id: decisions.id });

      if (!row) {
        throw new OperationError(
          "not_found",
          "The decision could not be recorded.",
        );
      }

      return {
        result: { id: row.id, goalId },
        activity: {
          kind: "session.decisionRecorded",
          subjectType: "goal",
          subjectId: goalId,
          contextId: decisionContextId,
          payload: {
            sessionId: input.sessionId,
            keyResultId: input.keyResultId ?? null,
          },
        },
        audit: {
          action: "sessions.recordDecision",
          targetType: "decision",
          targetId: row.id,
        },
      };
    },
  }),
});

const decisionOutput = z.object({
  id: z.uuid(),
  text: z.string(),
  at: z.string(),
  authorMemberId: z.uuid(),
  authorName: z.string(),
  goalId: z.uuid().nullable(),
  goalTitle: z.string().nullable(),
  keyResultId: z.uuid().nullable(),
  keyResultTitle: z.string().nullable(),
  sessionId: z.uuid().nullable(),
});

type DecisionOutput = z.infer<typeof decisionOutput>;

/** The shared shape of a decision row wherever it is listed. */
function decisionRow(row: {
  id: string;
  text: string;
  at: string;
  authorMemberId: string;
  authorName: string | null;
  goalId: string | null;
  goalTitle: string | null;
  keyResultId: string | null;
  keyResultTitle: string | null;
  sessionId: string | null;
}): DecisionOutput {
  return {
    id: row.id,
    text: row.text,
    at: row.at,
    authorMemberId: row.authorMemberId,
    // Left-joined, so a decision by a member who has since been removed still
    // reads rather than dropping out of the log §7.5 calls the artifact.
    authorName: row.authorName ?? "Unknown",
    goalId: row.goalId,
    goalTitle: row.goalTitle,
    keyResultId: row.keyResultId,
    keyResultTitle: row.keyResultTitle,
    sessionId: row.sessionId,
  };
}

const decisionColumns = {
  id: decisions.id,
  text: decisions.text,
  at: decisions.at,
  authorMemberId: decisions.authorMemberId,
  authorName: workspaceMembers.name,
  goalId: decisions.goalId,
  goalTitle: goals.title,
  keyResultId: decisions.keyResultId,
  keyResultTitle: keyResults.title,
  sessionId: decisions.sessionId,
} as const;

export const readMonthlyRecord = defineReadAction({
  name: "sessions.monthlyRecord",
  summary:
    "Everything METHOD.md §7.5 records for one monthly review: trends, the dependency log, the shifts note and the decisions.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.object({
    shifts: z.string().nullable(),
    trends: z.array(
      z.object({
        goalId: z.uuid(),
        goalTitle: z.string(),
        trend: z.enum(OBJECTIVE_TRENDS),
        /**
         * §3.7's signal from the stored progress, shown beside the trend and
         * never instead of it. The trend is the room's judgement; this is the
         * number they judged against.
         */
        signal: z.enum(["green", "amber", "red"]).nullable(),
        progressPct: z.number(),
      }),
    ),
    /** Objectives in the review's scope with no trend recorded yet. */
    untrended: z.array(z.object({ goalId: z.uuid(), goalTitle: z.string() })),
    dependencies: z.array(
      z.object({
        id: z.uuid(),
        keyResultId: z.uuid(),
        keyResultTitle: z.string(),
        description: z.string(),
        confirmed: z.boolean(),
        riskOwnerId: z.uuid().nullable(),
      }),
    ),
    decisions: z.array(decisionOutput),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const session = await requireMonthly(
          tx,
          context.workspaceId,
          memberId,
          input.sessionId,
          ACCESS_LEVELS.view,
        );

        const { thresholds } = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );
        const timeZone = await workspaceTimeZone(tx, context.workspaceId);

        // Every open objective in the review's scope, so the screen can list
        // what still has no trend rather than only what has one. Closed
        // objectives are left out: a review asks where the work is going, and
        // a finished objective is not going anywhere.
        const goalRows = await tx
          .select({
            id: goals.id,
            title: goals.title,
            progressPct: goals.progressPct,
          })
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              session.spaceId ? eq(goals.spaceId, session.spaceId) : sql`true`,
              session.cycleId ? eq(goals.cycleId, session.cycleId) : sql`true`,
              isNull(goals.closedAt),
            ),
          )
          // Ordered, because an unordered list reshuffles between loads and a
          // facilitator working down a screen loses their place.
          .orderBy(goals.position, goals.createdAt);

        const trendRows = await tx
          .select({
            goalId: objectiveTrends.goalId,
            trend: objectiveTrends.trend,
          })
          .from(objectiveTrends)
          .where(
            activeOnly(
              objectiveTrends,
              eq(objectiveTrends.workspaceId, context.workspaceId),
              // Keyed on the month the review covers, so a rescheduled or
              // repeated review reads back the same opinion.
              eq(
                objectiveTrends.month,
                firstOfMonth(session.scheduledFor, timeZone),
              ),
            ),
          );
        const byGoal = new Map(trendRows.map((row) => [row.goalId, row.trend]));

        const trends = goalRows.flatMap((goal) => {
          const trend = byGoal.get(goal.id);
          if (!trend) {
            return [];
          }
          const progressPct = Number(goal.progressPct);
          return [
            {
              goalId: goal.id,
              goalTitle: goal.title,
              trend,
              signal: Number.isFinite(progressPct)
                ? progressSignal(progressPct, thresholds)
                : null,
              progressPct,
            },
          ];
        });

        const untrended = goalRows
          .filter((goal) => !byGoal.has(goal.id))
          .map((goal) => ({ goalId: goal.id, goalTitle: goal.title }));

        // §7.5's dependency and risk log, read from P3-T09's register rather
        // than stored a second time here.
        const dependencyRows = await tx
          .select({
            id: keyResultDependencies.id,
            keyResultId: keyResultDependencies.keyResultId,
            keyResultTitle: keyResults.title,
            note: keyResultDependencies.note,
            providerText: keyResultDependencies.providerText,
            confirmed: keyResultDependencies.confirmed,
            riskOwnerId: keyResultDependencies.riskOwnerId,
          })
          .from(keyResultDependencies)
          .innerJoin(
            keyResults,
            eq(keyResults.id, keyResultDependencies.keyResultId),
          )
          .innerJoin(goals, eq(goals.id, keyResults.goalId))
          .where(
            activeOnly(
              keyResultDependencies,
              eq(keyResultDependencies.workspaceId, context.workspaceId),
              session.spaceId ? eq(goals.spaceId, session.spaceId) : sql`true`,
              session.cycleId ? eq(goals.cycleId, session.cycleId) : sql`true`,
            ),
          );

        const decisionRows = await tx
          .select(decisionColumns)
          .from(decisions)
          .leftJoin(
            workspaceMembers,
            eq(workspaceMembers.id, decisions.authorMemberId),
          )
          .leftJoin(goals, eq(goals.id, decisions.goalId))
          .leftJoin(keyResults, eq(keyResults.id, decisions.keyResultId))
          .where(
            activeOnly(
              decisions,
              eq(decisions.workspaceId, context.workspaceId),
              eq(decisions.sessionId, input.sessionId),
            ),
          )
          .orderBy(desc(decisions.at));

        return {
          shifts: session.shifts,
          trends,
          untrended,
          dependencies: dependencyRows.map((row) => ({
            id: row.id,
            keyResultId: row.keyResultId,
            keyResultTitle: row.keyResultTitle,
            description: row.note ?? row.providerText ?? "",
            confirmed: row.confirmed,
            riskOwnerId: row.riskOwnerId,
          })),
          decisions: decisionRows.map(decisionRow),
        };
      },
    );
  },
});

export const decisionsForGoal = defineReadAction({
  name: "decisions.forGoal",
  summary:
    "Decisions affecting one goal, newest first, for its page (METHOD.md §7.5).",
  input: z.object({ goalId: z.uuid() }),
  output: z.array(decisionOutput),
  access: ACCESS_LEVELS.view,
  async handler(context, input): Promise<DecisionOutput[]> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such goal.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        // Not-found on forbidden, through the one access getter, and before
        // any decision is read. A caller cannot learn that a decision exists
        // by watching an empty list come back instead of a refusal.
        await getAccessScoped(tx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "goal",
          resourceId: input.goalId,
          requires: ACCESS_LEVELS.view as never,
        });

        const rows = await tx
          .select(decisionColumns)
          .from(decisions)
          .leftJoin(
            workspaceMembers,
            eq(workspaceMembers.id, decisions.authorMemberId),
          )
          .leftJoin(goals, eq(goals.id, decisions.goalId))
          .leftJoin(keyResults, eq(keyResults.id, decisions.keyResultId))
          .where(
            activeOnly(
              decisions,
              eq(decisions.workspaceId, context.workspaceId),
              eq(decisions.goalId, input.goalId),
            ),
          )
          .orderBy(desc(decisions.at));

        return rows.map(decisionRow);
      },
    );
  },
});

export const decisionsForCycle = defineReadAction({
  name: "decisions.forCycle",
  summary:
    "Every decision recorded in one cycle, for the cycle workspace (METHOD.md §7.5).",
  input: z.object({ cycleId: z.uuid() }),
  output: z.array(decisionOutput),
  access: ACCESS_LEVELS.view,
  async handler(context, input): Promise<DecisionOutput[]> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such cycle.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        // Filtered on the decision's own `cycle_id`, not on the goal's.
        // `goals.moveToCycle` exists, so joining through the goal would move
        // every past decision into whichever cycle the goal ends up in, and a
        // decision taken in Q1 would start reading as a Q2 decision.
        //
        // Scoped by row-level security rather than by a getter call per row:
        // the getter refuses one resource at a time and this list spans a
        // whole cycle. The left join to `goals` is for the title only.
        const rows = await tx
          .select(decisionColumns)
          .from(decisions)
          .leftJoin(goals, eq(goals.id, decisions.goalId))
          .leftJoin(
            workspaceMembers,
            eq(workspaceMembers.id, decisions.authorMemberId),
          )
          .leftJoin(keyResults, eq(keyResults.id, decisions.keyResultId))
          .where(
            activeOnly(
              decisions,
              eq(decisions.workspaceId, context.workspaceId),
              eq(decisions.cycleId, input.cycleId),
            ),
          )
          .orderBy(desc(decisions.at));

        return rows.map(decisionRow);
      },
    );
  },
});

// ---------------------------------------------------------------------------
// The quarterly review's pacing (METHOD.md §8.1, P4-T10a-a)
// ---------------------------------------------------------------------------

/**
 * The session, refused unless the caller is the facilitator running it.
 *
 * Space access is not enough for these two. §8.1 gives the add-a-minute
 * control and the private notes to the facilitator by name, and the write-access
 * floor in this repository is `edit` for every active member (P3-T16), so
 * `ACCESS_LEVELS.edit` alone would hand both to the whole room.
 */
async function requireFacilitator(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  sessionId: string,
) {
  const session = await requireSessionAccess(
    tx,
    workspaceId,
    memberId,
    sessionId,
    ACCESS_LEVELS.edit,
  );
  if (session.facilitatorId !== memberId) {
    throw new OperationError(
      "forbidden",
      "Only the session's facilitator can do that.",
    );
  }
  return session;
}

export const addStageMinute = defineWriteAction({
  name: "sessions.addMinute",
  summary:
    "Gives the running stage one more minute (METHOD.md §8.1's add-a-minute control).",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), stageKey: z.string(), added: z.number() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireFacilitator(
        tx,
        workspaceId,
        memberId,
        input.id,
      );

      if (session.state !== "running" || !session.stageKey) {
        throw new OperationError(
          "not_found",
          "No stage is running, so there is nothing to extend.",
        );
      }

      // One stage's minute, not the agenda's. §11's stage minutes are the
      // workspace's standing agenda and a room running long on one day must
      // not retune every future review.
      const added = (session.addedMinutes ?? {}) as Record<string, number>;
      const next = (added[session.stageKey] ?? 0) + 1;

      await tx
        .update(sessions)
        .set({
          addedMinutes: { ...added, [session.stageKey]: next },
          updatedAt: new Date(),
        })
        .where(activeOnly(sessions, eq(sessions.id, input.id)));

      return {
        result: { id: input.id, stageKey: session.stageKey, added: next },
        activity: {
          kind: "session.minuteAdded",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          contextId: session.spaceId
            ? await resolveSpaceContextId(tx, workspaceId, session.spaceId)
            : undefined,
          payload: { stageKey: session.stageKey, added: next },
        },
        audit: {
          action: "sessions.addMinute",
          targetType: "session",
          targetId: input.id,
        },
      };
    },
  }),
});

export const setStageNote = defineWriteAction({
  name: "sessions.setStageNote",
  summary:
    "Writes the facilitator's private note for the running stage (METHOD.md §8.1).",
  input: z.object({
    id: z.uuid(),
    note: z.string().trim().max(4000),
  }),
  output: z.object({ id: z.uuid(), stageKey: z.string() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireFacilitator(
        tx,
        workspaceId,
        memberId,
        input.id,
      );

      if (session.state !== "running" || !session.stageKey) {
        throw new OperationError(
          "not_found",
          "No stage is running, so there is nothing to note.",
        );
      }

      // One note per stage, keyed the same way `elapsed` is. A single note per
      // session would make the eleventh stage overwrite the first, and a
      // facilitator reads these back stage by stage while the review runs.
      const notes = (session.notes ?? {}) as Record<string, unknown>;
      const next = { ...notes };
      if (input.note.length === 0) {
        // Cleared rather than stored empty, so the screen can tell "nothing
        // written" from "written and then emptied".
        delete next[session.stageKey];
      } else {
        next[session.stageKey] = input.note;
      }

      await tx
        .update(sessions)
        .set({ notes: next, updatedAt: new Date() })
        .where(activeOnly(sessions, eq(sessions.id, input.id)));

      return {
        result: { id: input.id, stageKey: session.stageKey },
        // **The payload names the stage and never the note.** An activity row
        // is read by everybody who can see the space, and the whole point of
        // this column is that the note is not.
        activity: {
          kind: "session.stageNoteSet",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          contextId: session.spaceId
            ? await resolveSpaceContextId(tx, workspaceId, session.spaceId)
            : undefined,
          payload: { stageKey: session.stageKey },
        },
        audit: {
          action: "sessions.setStageNote",
          targetType: "session",
          targetId: input.id,
        },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// The room pulse (METHOD.md §8.2, P4-T10a-b)
// ---------------------------------------------------------------------------

export const givePulse = defineWriteAction({
  name: "sessions.givePulse",
  summary:
    "Records one participant's pulse and their one word for the cycle (METHOD.md §8.2).",
  input: z.object({
    sessionId: z.uuid(),
    pulse: z.number().int().min(1).max(5),
    // §8.2 asks for one word. A sentence here turns the read of the room into a
    // paragraph nobody scans, so the boundary refuses it by name rather than
    // truncating silently.
    word: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((value) => !/\s/.test(value), {
        message: "One word, not a sentence.",
      }),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireSessionAccess(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );
      if (session.kind !== "quarterly") {
        throw new OperationError(
          "not_found",
          "The room pulse belongs to a quarterly review.",
        );
      }

      const [existing] = await tx
        .select({ id: sessionParticipants.id })
        .from(sessionParticipants)
        .where(
          activeOnly(
            sessionParticipants,
            eq(sessionParticipants.workspaceId, workspaceId),
            eq(sessionParticipants.sessionId, input.sessionId),
            eq(sessionParticipants.memberId, memberId),
          ),
        )
        .limit(1);

      // One person, one voice. Changing your mind corrects the row rather than
      // adding a second pulse that would weight whoever spoke twice.
      const [row] = existing
        ? await tx
            .update(sessionParticipants)
            .set({
              pulse: input.pulse,
              word: input.word,
              attended: true,
              updatedAt: new Date(),
            })
            .where(
              activeOnly(
                sessionParticipants,
                eq(sessionParticipants.id, existing.id),
              ),
            )
            .returning({ id: sessionParticipants.id })
        : await tx
            .insert(sessionParticipants)
            .values({
              workspaceId,
              sessionId: input.sessionId,
              memberId,
              pulse: input.pulse,
              word: input.word,
            })
            .returning({ id: sessionParticipants.id });

      if (!row) {
        throw new OperationError("not_found", "The pulse could not be saved.");
      }

      return {
        result: { id: row.id },
        // **The payload carries neither the pulse nor the word.** An activity
        // row is read by everybody who can see the space, and §8.2 gives the
        // room's read to the facilitator: a feed that announced each number
        // would hand the room its own average one entry at a time.
        activity: {
          kind: "session.pulseGiven",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          contextId: session.spaceId
            ? await resolveSpaceContextId(tx, workspaceId, session.spaceId)
            : undefined,
          payload: { sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.givePulse",
          targetType: "session_participant",
          targetId: row.id,
        },
      };
    },
  }),
});

/**
 * The words given, counted and sorted, with nothing that points at a person.
 *
 * Sorted by count then alphabetically, so the order is a property of the words
 * rather than of the rows: row order can be lined up against a member list, and
 * §8.2 asks for the room's mood rather than who felt what.
 */
function countWords(
  rows: readonly { readonly word: string | null }[],
): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.word === null) {
      continue;
    }
    const key = row.word.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

export const readRoomPulse = defineReadAction({
  name: "sessions.roomPulse",
  summary:
    "§8.2's read of the room for the facilitator, and the caller's own pulse for everybody.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.object({
    /** Null for anybody but the facilitator, and until somebody has spoken. */
    average: z.number().nullable(),
    band: z.enum(["energetic", "steady", "costly"]).nullable(),
    /** METHOD.md §8.2's sentence for the band. */
    read: z.string().nullable(),
    /** How many have given a pulse, and how many are in the space. */
    given: z.number(),
    expected: z.number(),
    /** The caller's own pulse and word, always. */
    mine: z.object({
      pulse: z.number().nullable(),
      word: z.string().nullable(),
    }),
    /**
     * The words given, counted, for the facilitator.
     *
     * Counted rather than listed, and that is a privacy decision as much as a
     * display one: a list in row order can be lined up against the member list,
     * and §8.2 asks for the room's mood rather than who felt what. "tired 2"
     * says the thing without naming anybody.
     */
    words: z.array(z.object({ word: z.string(), count: z.number() })),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const session = await requireSessionAccess(
          tx,
          context.workspaceId,
          memberId,
          input.sessionId,
          ACCESS_LEVELS.view,
        );

        const rows = await tx
          .select({
            memberId: sessionParticipants.memberId,
            pulse: sessionParticipants.pulse,
            word: sessionParticipants.word,
          })
          .from(sessionParticipants)
          .where(
            activeOnly(
              sessionParticipants,
              eq(sessionParticipants.workspaceId, context.workspaceId),
              eq(sessionParticipants.sessionId, input.sessionId),
            ),
          );

        const spoken = rows.filter(
          (row): row is typeof row & { pulse: number } => row.pulse !== null,
        );
        const mineRow = rows.find((row) => row.memberId === memberId);

        // How many the room is waiting for. Every active member of the space,
        // which is the same list `sessions.participants` reads.
        const expectedRows = session.spaceId
          ? await tx
              .select({ memberId: spaceMembers.memberId })
              .from(spaceMembers)
              .innerJoin(
                workspaceMembers,
                eq(workspaceMembers.id, spaceMembers.memberId),
              )
              .where(
                activeOnly(
                  spaceMembers,
                  eq(spaceMembers.workspaceId, context.workspaceId),
                  eq(spaceMembers.spaceId, session.spaceId),
                  eq(workspaceMembers.status, "active"),
                ),
              )
          : [];

        const isFacilitator = session.facilitatorId === memberId;
        const { thresholds } = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );
        // §8.2's own function, from `packages/method`. The boundaries are §11's
        // and the sentences are the document's, so nothing about the read is
        // decided here.
        const read = isFacilitator
          ? roomPulseRead(
              spoken.map((row) => row.pulse),
              thresholds,
            )
          : null;

        return {
          average: read?.average ?? null,
          band: read?.band ?? null,
          read: read?.read ?? null,
          given: spoken.length,
          expected: expectedRows.length,
          mine: {
            pulse: mineRow?.pulse ?? null,
            word: mineRow?.word ?? null,
          },
          // The words go with the read, for the same reason: a participant who
          // could see the room's words could read the room's mood.
          words: isFacilitator ? countWords(rows) : [],
        };
      },
    );
  },
});

// ---------------------------------------------------------------------------
// Scoring the key results (METHOD.md §8.3, P4-T10b-a)
// ---------------------------------------------------------------------------

/** The session, refused unless it is a quarterly review. */
async function requireQuarterly(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  sessionId: string,
  requires: number,
) {
  const session = await requireSessionAccess(
    tx,
    workspaceId,
    memberId,
    sessionId,
    requires,
  );
  if (session.kind !== "quarterly") {
    throw new OperationError(
      "not_found",
      "Scoring belongs to a quarterly review.",
    );
  }
  return session;
}

export const scoreKeyResult = defineWriteAction({
  name: "sessions.scoreKeyResult",
  summary:
    "Grades one key result 0.0 to 1.0 with the one-line reason §8.3 asks for.",
  input: z.object({
    sessionId: z.uuid(),
    keyResultId: z.uuid(),
    score: z.number().min(0).max(1),
    // §8.3 asks for a one-line reason. "Facts, not feelings" cannot be
    // enforced; a score nobody explained can be refused.
    reason: z.string().trim().min(1).max(500),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      await requireQuarterly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      // The key result is authorised through its objective, which is where
      // access lives.
      const [owner] = await tx
        .select({ goalId: keyResults.goalId })
        .from(keyResults)
        .where(
          activeOnly(
            keyResults,
            eq(keyResults.workspaceId, workspaceId),
            eq(keyResults.id, input.keyResultId),
          ),
        )
        .limit(1);
      if (!owner) {
        throw new OperationError("not_found", "No such key result.");
      }
      const { contextId } = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: owner.goalId,
        requires: ACCESS_LEVELS.edit as never,
      });

      const [existing] = await tx
        .select({ id: reviewScores.id })
        .from(reviewScores)
        .where(
          activeOnly(
            reviewScores,
            eq(reviewScores.workspaceId, workspaceId),
            eq(reviewScores.sessionId, input.sessionId),
            eq(reviewScores.keyResultId, input.keyResultId),
          ),
        )
        .limit(1);

      // Regrading corrects the row. A room that talks itself from 0.6 to 0.4
      // has one answer, not two, and the second would double its weight in
      // both the objective score and the cycle score.
      const [row] = existing
        ? await tx
            .update(reviewScores)
            .set({
              score: String(input.score),
              reason: input.reason,
              scoredById: memberId,
              updatedAt: new Date(),
            })
            .where(activeOnly(reviewScores, eq(reviewScores.id, existing.id)))
            .returning({ id: reviewScores.id })
        : await tx
            .insert(reviewScores)
            .values({
              workspaceId,
              sessionId: input.sessionId,
              keyResultId: input.keyResultId,
              score: String(input.score),
              reason: input.reason,
              scoredById: memberId,
            })
            .returning({ id: reviewScores.id });

      if (!row) {
        throw new OperationError("not_found", "The score could not be saved.");
      }

      return {
        result: { id: row.id },
        // **The payload carries no score.** An activity row is read by
        // everybody who can see the space, and §8.3 hides the objective score
        // until the room reveals it: a feed announcing each grade would reveal
        // it one entry at a time.
        activity: {
          kind: "session.keyResultScored",
          subjectType: "goal",
          subjectId: owner.goalId,
          contextId,
          payload: { sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.scoreKeyResult",
          targetType: "review_score",
          targetId: row.id,
        },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// Stage three: objective narratives, and stage four: recognition (METHOD.md
// §8.1, p4-t00-session-design.md §4.4 and §4.5, P4-T10c)
// ---------------------------------------------------------------------------

/** Editor JSON for the current rich text schema, or null. */
const narrativeBody = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

/**
 * The review's own objectives: this space, this cycle, still open.
 *
 * The same predicate `sessions.scoringStatus` reads, and the reason the mic
 * cannot be handed to a goal from another space: the stage is about the
 * objectives the room is reviewing, and a goal outside that set is not one.
 *
 * **Returns the conditions, not a finished predicate.** Wrapping `activeOnly`
 * in here is correct and unprovable: the soft-delete lint reads the call site,
 * and a `from(goals)` whose scope arrives through a function call is
 * indistinguishable from one that has no scope. That gate exists to catch
 * exactly the fail-open shape, so every caller spells `activeOnly(goals, ...)`
 * out loud and this only holds the three conditions that are easy to forget.
 */
function reviewObjectiveConditions(
  workspaceId: string,
  session: { spaceId: string | null; cycleId: string | null },
) {
  return [
    eq(goals.workspaceId, workspaceId),
    session.spaceId ? eq(goals.spaceId, session.spaceId) : sql`true`,
    session.cycleId ? eq(goals.cycleId, session.cycleId) : sql`true`,
    isNull(goals.closedAt),
  ] as const;
}

export const passMic = defineWriteAction({
  name: "sessions.passMic",
  summary:
    "Hands the mic to one objective's owner, or puts it down (METHOD.md §8.1 stage 3).",
  input: z.object({
    sessionId: z.uuid(),
    /**
     * Null puts the mic down and ends the round.
     *
     * Without it the last objective would never be marked spoken, because the
     * thing that marks an objective is the mic moving on from it and nothing
     * takes the mic after the last owner.
     */
    goalId: z.uuid().nullable(),
  }),
  output: z.object({
    micGoalId: z.uuid().nullable(),
    spokenGoalId: z.uuid().nullable(),
    realtimeChannel: z.string(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireQuarterly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );
      // §4.4 gives the pass-the-mic control to the facilitator. The write-access
      // floor here is `edit` for every active member (P3-T16), so `edit` alone
      // would let any participant take the mic off whoever is speaking.
      if (session.facilitatorId !== memberId) {
        throw new OperationError(
          "forbidden",
          "Only the session's facilitator can pass the mic.",
        );
      }

      if (input.goalId) {
        const [inScope] = await tx
          .select({ id: goals.id })
          .from(goals)
          .where(
            activeOnly(
              goals,
              ...reviewObjectiveConditions(workspaceId, session),
              eq(goals.id, input.goalId),
            ),
          )
          .limit(1);
        if (!inScope) {
          throw new OperationError(
            "not_found",
            "That objective is not in this review.",
          );
        }
        await getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "goal",
          resourceId: input.goalId,
          requires: ACCESS_LEVELS.edit as never,
        });
      }

      const now = new Date();
      const leaving = session.micGoalId;

      // The objective the mic leaves is spoken for. A row is created if there is
      // none, carrying no body and no author: most narratives are told and never
      // typed, and the facilitator marking the turn over did not write anything.
      if (leaving && leaving !== input.goalId) {
        const [existing] = await tx
          .select({
            id: reviewNarratives.id,
            spokenAt: reviewNarratives.spokenAt,
          })
          .from(reviewNarratives)
          .where(
            activeOnly(
              reviewNarratives,
              eq(reviewNarratives.workspaceId, workspaceId),
              eq(reviewNarratives.sessionId, input.sessionId),
              eq(reviewNarratives.goalId, leaving),
            ),
          )
          .limit(1);

        if (!existing) {
          await tx.insert(reviewNarratives).values({
            workspaceId,
            sessionId: input.sessionId,
            goalId: leaving,
            spokenAt: now,
          });
        } else if (existing.spokenAt === null) {
          // Only when it has not been marked. A room that comes back to an
          // objective for a question is not the owner telling their story a
          // second time, and re-stamping would move when they told it.
          await tx
            .update(reviewNarratives)
            .set({ spokenAt: now, updatedAt: now })
            .where(
              activeOnly(
                reviewNarratives,
                eq(reviewNarratives.id, existing.id),
              ),
            );
        }
      }

      await tx
        .update(sessions)
        .set({ micGoalId: input.goalId, updatedAt: now })
        .where(activeOnly(sessions, eq(sessions.id, input.sessionId)));

      const channel = sessionChannel(workspaceId, input.sessionId);
      const spokenGoalId = leaving && leaving !== input.goalId ? leaving : null;

      return {
        result: {
          micGoalId: input.goalId,
          spokenGoalId,
          realtimeChannel: channel,
        },
        /**
         * The push, as an outbox row. **No relay drains the outbox yet**, the
         * same position P4-T10a-a recorded for `session.stageChanged` and
         * P4-T10b-b for the score reveal: one write, every client that re-reads
         * agrees who is speaking, and the rail goes live the day a relay host
         * exists.
         *
         * The key carries the destination and the clock, because passing the mic
         * back to an objective it already visited is a real move rather than a
         * retry of the first one.
         */
        outbox: [
          {
            topic: "session.micPassed",
            payload: {
              channel,
              sessionId: input.sessionId,
              workspaceId,
              goalId: input.goalId,
            },
            idempotencyKey: `session.micPassed:${input.sessionId}:${input.goalId ?? "down"}:${now.toISOString()}`,
          },
        ],
        activity: {
          kind: "session.micPassed",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          contextId: session.spaceId
            ? await resolveSpaceContextId(tx, workspaceId, session.spaceId)
            : undefined,
          payload: { sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.passMic",
          targetType: "session",
          targetId: input.sessionId,
          payload: { goalId: input.goalId, spokenGoalId },
        },
      };
    },
  }),
});

export const setNarrative = defineWriteAction({
  name: "sessions.setNarrative",
  summary:
    "Writes what the number does not show for one objective (METHOD.md §8.1 stage 3).",
  input: z.object({
    sessionId: z.uuid(),
    goalId: z.uuid(),
    body: narrativeBody,
  }),
  output: z.object({ goalId: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireQuarterly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );
      // Not the facilitator's alone. §8.1 stage 3 is owner by owner, and an
      // objective's champion is often not the person running the review: a
      // narrative only the facilitator could write would be the facilitator
      // telling somebody else's story.
      const [inScope] = await tx
        .select({ id: goals.id })
        .from(goals)
        .where(
          activeOnly(
            goals,
            ...reviewObjectiveConditions(workspaceId, session),
            eq(goals.id, input.goalId),
          ),
        )
        .limit(1);
      if (!inScope) {
        throw new OperationError(
          "not_found",
          "That objective is not in this review.",
        );
      }
      const { contextId } = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: input.goalId,
        requires: ACCESS_LEVELS.edit as never,
      });

      const now = new Date();
      const cleared = input.body === null;
      const [existing] = await tx
        .select({ id: reviewNarratives.id })
        .from(reviewNarratives)
        .where(
          activeOnly(
            reviewNarratives,
            eq(reviewNarratives.workspaceId, workspaceId),
            eq(reviewNarratives.sessionId, input.sessionId),
            eq(reviewNarratives.goalId, input.goalId),
          ),
        )
        .limit(1);

      // The author goes with the body. Clearing the note drops both, because an
      // author on an empty narrative names somebody for something that is no
      // longer there, and the table's own check constraint refuses it.
      const values = {
        body: cleared ? null : input.body,
        bodyVersion: cleared ? null : RICH_TEXT_SCHEMA_VERSION,
        authorMemberId: cleared ? null : memberId,
        updatedAt: now,
      };

      if (existing) {
        // Rewrites rather than storing two: an objective's story is one story,
        // and a second row would make the stage list it twice.
        await tx
          .update(reviewNarratives)
          .set(values)
          .where(
            activeOnly(reviewNarratives, eq(reviewNarratives.id, existing.id)),
          );
      } else {
        await tx.insert(reviewNarratives).values({
          workspaceId,
          sessionId: input.sessionId,
          goalId: input.goalId,
          ...values,
        });
      }

      return {
        result: { goalId: input.goalId },
        /**
         * The payload carries no narrative text.
         *
         * An activity row reaches everybody who can see the space, and a
         * narrative written inside a review is for the room in it. The feed can
         * say the story was written without repeating it.
         */
        activity: {
          kind: "session.narrativeWritten",
          subjectType: "goal",
          subjectId: input.goalId,
          contextId,
          payload: { sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.setNarrative",
          targetType: "session",
          targetId: input.sessionId,
          payload: { goalId: input.goalId, cleared },
        },
      };
    },
  }),
});

export const giveKudos = defineWriteAction({
  name: "sessions.giveKudos",
  summary:
    "Names the effort that deserved to be seen (METHOD.md §8.1 stage 4).",
  input: z.object({
    sessionId: z.uuid(),
    toMemberId: z.uuid(),
    // §8.1: "Specific beats generous." A required line is the only part of that
    // a product can hold.
    text: z.string().trim().min(1).max(500),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireQuarterly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );

      if (input.toMemberId === memberId) {
        // Recognising yourself is not recognition. §8.1 asks the room to name
        // the effort it saw, and the room is other people.
        throw new OperationError(
          "forbidden",
          "Recognition names somebody else's effort.",
        );
      }

      // Active only. A suspended member is excluded from every access-scoped
      // read in this repository, so recognising one would name somebody the
      // room cannot see.
      const [recipient] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.id, input.toMemberId),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .limit(1);
      if (!recipient) {
        throw new OperationError("not_found", "No such member.");
      }

      const [row] = await tx
        .insert(kudos)
        .values({
          workspaceId,
          sessionId: input.sessionId,
          fromMemberId: memberId,
          toMemberId: input.toMemberId,
          text: input.text,
        })
        .returning({ id: kudos.id });
      if (!row) {
        throw new OperationError("not_found", "That did not save.");
      }

      return {
        result: { id: row.id },
        activity: {
          kind: "session.kudosGiven",
          subjectType: "space",
          subjectId: session.spaceId ?? workspaceId,
          contextId: session.spaceId
            ? await resolveSpaceContextId(tx, workspaceId, session.spaceId)
            : undefined,
          // The recipient, not the words. Recognition given in a review is for
          // the room, and the feed says it happened without quoting it.
          payload: { sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.giveKudos",
          targetType: "kudos",
          targetId: row.id,
        },
      };
    },
  }),
});

export const readNarratives = defineReadAction({
  name: "sessions.narratives",
  summary:
    "Stage three's state: who holds the mic, who has spoken, and what was written.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.object({
    /** The one objective speaking now, or null before and after the round. */
    micGoalId: z.uuid().nullable(),
    objectives: z.array(
      z.object({
        goalId: z.uuid(),
        goalTitle: z.string(),
        championName: z.string().nullable(),
        hasMic: z.boolean(),
        spokenAt: z.string().nullable(),
        /** Editor JSON, and null for the ordinary case of spoken and not typed. */
        body: z.unknown().nullable(),
        authorName: z.string().nullable(),
      }),
    ),
    spoken: z.number(),
    total: z.number(),
    /** Every objective spoken for. §8.1's completion condition for stage three. */
    complete: z.boolean(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const session = await requireQuarterly(
          tx,
          context.workspaceId,
          memberId,
          input.sessionId,
          ACCESS_LEVELS.view,
        );

        const champions = alias(workspaceMembers, "champions");
        const authors = alias(workspaceMembers, "authors");

        const rows = await tx
          .select({
            goalId: goals.id,
            goalTitle: goals.title,
            championName: champions.name,
            spokenAt: reviewNarratives.spokenAt,
            body: reviewNarratives.body,
            authorName: authors.name,
          })
          .from(goals)
          .leftJoin(champions, eq(champions.id, goals.championId))
          .leftJoin(
            reviewNarratives,
            and(
              eq(reviewNarratives.goalId, goals.id),
              eq(reviewNarratives.sessionId, input.sessionId),
              isNull(reviewNarratives.deletedAt),
            ),
          )
          .leftJoin(authors, eq(authors.id, reviewNarratives.authorMemberId))
          .where(
            activeOnly(
              goals,
              ...reviewObjectiveConditions(context.workspaceId, session),
            ),
          )
          .orderBy(goals.position, goals.createdAt);

        const objectives = rows.map((row) => ({
          goalId: row.goalId,
          goalTitle: row.goalTitle,
          championName: row.championName ?? null,
          hasMic: session.micGoalId === row.goalId,
          spokenAt: row.spokenAt?.toISOString() ?? null,
          body: row.body ?? null,
          authorName: row.authorName ?? null,
        }));
        const spoken = objectives.filter(
          (entry) => entry.spokenAt !== null,
        ).length;

        return {
          micGoalId: session.micGoalId ?? null,
          objectives,
          spoken,
          total: objectives.length,
          complete: objectives.length > 0 && spoken === objectives.length,
        };
      },
    );
  },
});

export const readRecognition = defineReadAction({
  name: "sessions.recognition",
  summary: "Stage four's entries, oldest first (METHOD.md §8.1 stage 4).",
  input: z.object({ sessionId: z.uuid() }),
  output: z.object({
    entries: z.array(
      z.object({
        id: z.uuid(),
        fromName: z.string(),
        toName: z.string(),
        text: z.string(),
        /** Whether the reader gave this one. */
        mine: z.boolean(),
      }),
    ),
    /**
     * Who the reader may name: every active member except themselves.
     *
     * Returned with the entries rather than left to the screen, because who can
     * be recognised is the same decision `sessions.giveKudos` enforces and two
     * places deciding it is one place to get it wrong. The reader is absent for
     * the reason the action refuses them: recognising yourself is not
     * recognition.
     */
    recipients: z.array(z.object({ memberId: z.uuid(), name: z.string() })),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        await requireQuarterly(
          tx,
          context.workspaceId,
          memberId,
          input.sessionId,
          ACCESS_LEVELS.view,
        );

        const givers = alias(workspaceMembers, "givers");
        const receivers = alias(workspaceMembers, "receivers");

        const rows = await tx
          .select({
            id: kudos.id,
            fromMemberId: kudos.fromMemberId,
            fromName: givers.name,
            toName: receivers.name,
            text: kudos.text,
          })
          .from(kudos)
          .innerJoin(givers, eq(givers.id, kudos.fromMemberId))
          .innerJoin(receivers, eq(receivers.id, kudos.toMemberId))
          .where(
            activeOnly(
              kudos,
              eq(kudos.workspaceId, context.workspaceId),
              eq(kudos.sessionId, input.sessionId),
            ),
          )
          // Oldest first, so the panel reads as the round happened rather than
          // reshuffling every time somebody adds one.
          .orderBy(kudos.createdAt);

        const recipients = await tx
          .select({
            memberId: workspaceMembers.id,
            name: workspaceMembers.name,
          })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.status, "active"),
              eq(workspaceMembers.kind, "human"),
              ne(workspaceMembers.id, memberId),
            ),
          )
          .orderBy(workspaceMembers.name);

        return {
          entries: rows.map((row) => ({
            id: row.id,
            fromName: row.fromName,
            toName: row.toName,
            text: row.text,
            mine: row.fromMemberId === memberId,
          })),
          recipients,
        };
      },
    );
  },
});

export const revealObjectiveScore = defineWriteAction({
  name: "sessions.revealObjectiveScore",
  summary:
    "Reveals one objective's score to the whole room in a single write (METHOD.md §8.3).",
  input: z.object({
    sessionId: z.uuid(),
    goalId: z.uuid(),
  }),
  output: z.object({
    revealed: z.number().int(),
    realtimeChannel: z.string(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }

      const session = await requireQuarterly(
        tx,
        workspaceId,
        memberId,
        input.sessionId,
        ACCESS_LEVELS.edit,
      );
      // §8.3 has the room grading and the room revealing *together*, which in
      // practice is the facilitator saying now. The write-access floor here is
      // `edit` for every active member (P3-T16), so `edit` alone would let any
      // participant pre-empt the room. Same reasoning as §8.1's add-a-minute
      // control.
      if (session.facilitatorId !== memberId) {
        throw new OperationError(
          "forbidden",
          "Only the session's facilitator can reveal a score.",
        );
      }

      // The objective, authorised where access lives.
      const { contextId } = await getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "goal",
        resourceId: input.goalId,
        requires: ACCESS_LEVELS.edit as never,
      });

      const now = new Date();
      // One update over the objective's rows. The room sees one answer because
      // there is one write, not because the clients agree to pretend.
      const revealed = await tx
        .update(reviewScores)
        .set({ revealedAt: now, updatedAt: now })
        .where(
          activeOnly(
            reviewScores,
            eq(reviewScores.workspaceId, workspaceId),
            eq(reviewScores.sessionId, input.sessionId),
            isNull(reviewScores.revealedAt),
            sql`${reviewScores.keyResultId} in (
              select kr.id from key_results kr
              where kr.goal_id = ${input.goalId}
                and kr.workspace_id = ${workspaceId}
                and kr.deleted_at is null
            )`,
          ),
        )
        .returning({ id: reviewScores.id });

      if (revealed.length === 0) {
        // Nothing was stamped, and the two reasons are not the same thing.
        //
        // Nothing graded is refused: an objective that entered its revealed
        // state with no grades behind it would show the room a blank where the
        // number goes. Already out is not refused, because a facilitator on a
        // stale screen pressing again should not meet an error, and there is no
        // error code in this codebase that means "already done" without also
        // claiming the objective does not exist. Same shape as
        // `sessions.revealVotes` (P3-T07), which also answers a redundant call
        // with a count of nought.
        const [graded] = await tx
          .select({ id: reviewScores.id })
          .from(reviewScores)
          .innerJoin(keyResults, eq(keyResults.id, reviewScores.keyResultId))
          .where(
            activeOnly(
              reviewScores,
              eq(reviewScores.workspaceId, workspaceId),
              eq(reviewScores.sessionId, input.sessionId),
              eq(keyResults.goalId, input.goalId),
            ),
          )
          .limit(1);
        if (!graded) {
          throw new OperationError(
            "not_found",
            "Nothing is graded on this objective, so there is no score to reveal.",
          );
        }
      }

      const channel = sessionChannel(workspaceId, input.sessionId);

      return {
        result: { revealed: revealed.length, realtimeChannel: channel },
        /**
         * The push, as an outbox row (the only way a side effect may leave a
         * write path).
         *
         * The key carries the objective, so revealing two objectives enqueues
         * two rows. **A redundant reveal enqueues nothing**, which is the same
         * fact stated twice: the key would collide with the row the first reveal
         * wrote, and there is no second reveal to push. That collision is not
         * theoretical, it failed the idempotence test before this guard existed.
         *
         * **No relay drains the outbox yet**, exactly as P4-T10a-a recorded for
         * `session.stageChanged`: the write is one write and every client that
         * re-reads gets the same answer, and the moment a relay host exists the
         * rail becomes live with no change here.
         */
        outbox:
          revealed.length === 0
            ? []
            : [
                {
                  topic: "session.scoresRevealed",
                  payload: {
                    channel,
                    sessionId: input.sessionId,
                    workspaceId,
                    goalId: input.goalId,
                  },
                  idempotencyKey: `session.scoresRevealed:${input.sessionId}:${input.goalId}`,
                },
              ],
        /**
         * The payload carries no score, unlike the reveal itself.
         *
         * An activity row is read by everybody who can see the space, which is
         * wider than the room in the review. Revealing to the room is not
         * publishing to the space, and the feed can say the room got there
         * without carrying the number out of it.
         */
        activity: {
          kind: "session.objectiveScoreRevealed",
          subjectType: "goal",
          subjectId: input.goalId,
          contextId,
          payload: { sessionId: input.sessionId },
        },
        audit: {
          action: "sessions.revealObjectiveScore",
          targetType: "session",
          targetId: input.sessionId,
          payload: { goalId: input.goalId, revealed: revealed.length },
        },
      };
    },
  }),
});

const scoringKeyResult = z.object({
  keyResultId: z.uuid(),
  title: z.string(),
  weight: z.number(),
  /** §8.3's evidence, read from the key result rather than typed into the review. */
  baseline: z.number().nullable(),
  target: z.number().nullable(),
  current: z.number().nullable(),
  unit: z.string().nullable(),
  score: z.number().nullable(),
  reason: z.string().nullable(),
});

export const readScoringStatus = defineReadAction({
  name: "sessions.scoringStatus",
  summary:
    "Stage two's state: the evidence, the grades so far, and the scores of the objectives the room has revealed.",
  input: z.object({ sessionId: z.uuid() }),
  output: z.object({
    objectives: z.array(
      z.object({
        goalId: z.uuid(),
        goalTitle: z.string(),
        /**
         * §3.2's weighted average over the graded key results, and **null until
         * the room reveals it** (§8.3, P4-T10b-b).
         *
         * Withheld here rather than on the screen. P4-T10b-a kept the number
         * off the grading screen and this read still returned it, so a second
         * surface, a REST caller or the agent tool catalogue saw what the room
         * had not.
         */
        score: z.number().nullable(),
        /** Whether the room has revealed this objective's score. */
        revealed: z.boolean(),
        scored: z.number(),
        total: z.number(),
        keyResults: z.array(scoringKeyResult),
      }),
    ),
    /**
     * §8.6's plain average, over the key results of the **revealed** objectives
     * only.
     *
     * Counting every grade would publish a hidden number under another label:
     * on a review with one objective whose key results carry equal weights, the
     * plain average and the weighted average are the same figure. Running
     * through the reveals also makes the acceptance criterion literal, because
     * revealing is then the thing that moves it. Agung decided this on
     * 26 August 2026, and p4-t00-session-design.md §4.3 is corrected to match.
     */
    cycleScore: z.number().nullable(),
    /** §3.4's verdict on that average. */
    verdict: z
      .enum(["too_safe", "healthy", "partial", "outran_capacity"])
      .nullable(),
    /** Every key result graded. §8.1's completion condition for stage two. */
    complete: z.boolean(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such session.");
    }

    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const session = await requireQuarterly(
          tx,
          context.workspaceId,
          memberId,
          input.sessionId,
          ACCESS_LEVELS.view,
        );

        const rows = await tx
          .select({
            goalId: goals.id,
            goalTitle: goals.title,
            goalPosition: goals.position,
            keyResultId: keyResults.id,
            title: keyResults.title,
            weight: keyResults.weight,
            baseline: keyResults.baselineValue,
            target: keyResults.targetValue,
            current: keyResults.currentValue,
            unit: keyResults.unit,
            position: keyResults.position,
          })
          .from(keyResults)
          .innerJoin(goals, eq(goals.id, keyResults.goalId))
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, context.workspaceId),
              session.spaceId ? eq(goals.spaceId, session.spaceId) : sql`true`,
              session.cycleId ? eq(goals.cycleId, session.cycleId) : sql`true`,
              isNull(goals.closedAt),
            ),
          )
          .orderBy(goals.position, goals.createdAt, keyResults.position);

        const graded = await tx
          .select({
            keyResultId: reviewScores.keyResultId,
            score: reviewScores.score,
            reason: reviewScores.reason,
            revealedAt: reviewScores.revealedAt,
          })
          .from(reviewScores)
          .where(
            activeOnly(
              reviewScores,
              eq(reviewScores.workspaceId, context.workspaceId),
              eq(reviewScores.sessionId, input.sessionId),
            ),
          );
        const byKeyResult = new Map(
          graded.map((row) => [
            row.keyResultId,
            {
              score: Number(row.score),
              reason: row.reason,
              revealed: row.revealedAt !== null,
            },
          ]),
        );

        // Grouped in the order the rows came back, so the screen reads down the
        // cascade rather than in whatever order Postgres chose.
        const objectives: {
          goalId: string;
          goalTitle: string;
          score: number | null;
          revealed: boolean;
          scored: number;
          total: number;
          keyResults: z.infer<typeof scoringKeyResult>[];
        }[] = [];
        for (const row of rows) {
          let objective = objectives.find(
            (entry) => entry.goalId === row.goalId,
          );
          if (!objective) {
            objective = {
              goalId: row.goalId,
              goalTitle: row.goalTitle,
              score: null,
              revealed: false,
              scored: 0,
              total: 0,
              keyResults: [],
            };
            objectives.push(objective);
          }
          const grade = byKeyResult.get(row.keyResultId);
          objective.total += 1;
          if (grade) {
            objective.scored += 1;
            // One reveal covers the objective, so one revealed row is the
            // objective revealed. A key result graded after the reveal joins the
            // number that is already out rather than hiding it again.
            if (grade.revealed) {
              objective.revealed = true;
            }
          }
          objective.keyResults.push({
            keyResultId: row.keyResultId,
            title: row.title,
            weight: Number(row.weight),
            baseline: row.baseline === null ? null : Number(row.baseline),
            target: row.target === null ? null : Number(row.target),
            current: row.current === null ? null : Number(row.current),
            unit: row.unit ?? null,
            score: grade?.score ?? null,
            reason: grade?.reason ?? null,
          });
        }

        for (const objective of objectives) {
          // §3.2's weighting, from `packages/method`. Nothing about how a score
          // is built is decided here.
          //
          // Computed only once the room has revealed it. An unrevealed
          // objective returns null, which is the test-plan line "no caller can
          // read an objective's score before it is revealed" held at the read
          // rather than at the screen.
          objective.score = objective.revealed
            ? objectiveScore(
                objective.keyResults.map((entry) => ({
                  score: entry.score,
                  weight: entry.weight,
                })),
              )
            : null;
        }

        const { thresholds } = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );
        // §8.6's own words: the §3.4 portfolio average over scored key results.
        // A plain average over key results, not over objective scores.
        //
        // Over the revealed rows only, for the reason the output schema gives:
        // a running average that counted unrevealed grades would be the hidden
        // objective score wearing a different label on any review with one
        // objective and even weights.
        const average = cycleScore(
          [...byKeyResult.values()]
            .filter((entry) => entry.revealed)
            .map((entry) => entry.score),
        );

        return {
          objectives,
          cycleScore: average,
          verdict:
            average === null ? null : portfolioVerdictOf(average, thresholds),
          complete:
            objectives.length > 0 &&
            objectives.every((entry) => entry.scored === entry.total),
        };
      },
    );
  },
});
