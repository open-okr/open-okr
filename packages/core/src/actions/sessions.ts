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
  SESSION_KINDS,
  SESSION_STATES,
  okrSessions as sessions,
  spaceMembers,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { WEEKLY_STAGE_KEYS } from "@openokr/method";
import { and, desc, eq } from "drizzle-orm";
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
