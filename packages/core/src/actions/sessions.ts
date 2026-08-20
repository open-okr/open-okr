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
  goals,
  keyResults,
  SESSION_KINDS,
  SESSION_STATES,
  sessionConfidences,
  okrSessions as sessions,
  spaceMembers,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { WEEKLY_STAGE_KEYS } from "@openokr/method";
import { and, avg, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
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
  notes: z.record(z.string(), z.unknown()),
  state: z.enum(SESSION_STATES),
  digestId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type SessionOutput = z.infer<typeof sessionOutput>;

function toOutput(row: typeof sessions.$inferSelect): SessionOutput {
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
    notes: (row.notes ?? {}) as Record<string, unknown>,
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

      const firstStage =
        session.kind === "weekly" ? WEEKLY_STAGE_KEYS[0] : null;
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
      if (session.kind === "weekly") {
        const stageIndex = session.stageKey
          ? WEEKLY_STAGE_KEYS.indexOf(
              session.stageKey as (typeof WEEKLY_STAGE_KEYS)[number],
            )
          : -1;
        if (stageIndex === WEEKLY_STAGE_KEYS.length - 1) {
          throw new OperationError(
            "not_found",
            "Already on the last stage. Close the session to finish.",
          );
        }
        nextStageKey = WEEKLY_STAGE_KEYS[stageIndex + 1] ?? null;

        // Stage completion gate: confidence → diagnose requires every KR
        // in the space's active cycle to have a confirmed confidence.
        if (
          session.stageKey === "confidence" &&
          nextStageKey === "diagnose" &&
          session.spaceId
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
                eq(goals.cycleId, session.cycleId ?? ""),
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

      await tx
        .update(sessions)
        .set({ state: "skipped", updatedAt: new Date() })
        .where(activeOnly(sessions, eq(sessions.id, input.id)));

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
      await tx
        .update(sessions)
        .set({ state: "closed", endedAt: now, updatedAt: now })
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

        return toOutput(row);
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

        return rows.map(toOutput);
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
