import {
  activeOnly,
  notifications,
  nudges,
  type WorkspaceTx,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import type { SuppressionReason } from "@openokr/method";
import { and, count, desc, eq, gte, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import { runDueNudgesInTx } from "../nudges/run.ts";
import { OperationError } from "../operations/errors.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/**
 * The nudge run and the nudge log (P4-T04a).
 *
 * The run is a write action rather than a job because it has to go through the
 * Operation pipeline like everything else: the nudge rows, the in-app
 * notifications and the audit row commit together or not at all. A job host
 * calls this on a schedule from P4-T05a; until then a workspace administrator
 * or a test can call it, and it is the same code either way.
 *
 * `now` is an input. A run that read the clock could not be driven across the
 * fortnight of a missed check-in that §11's ladder is written about, and that
 * fortnight is the acceptance criterion.
 */

export const runNudges = defineWriteAction({
  name: "nudges.run",
  summary:
    "Computes what is due for every member and records a nudge row for each, delivering to the in-app inbox.",
  input: z.object({
    /** Defaults to the moment the request arrives. Overridden by tests and backfills. */
    now: z.string().optional(),
  }),
  output: z.object({
    recorded: z.number().int(),
    /** Written with a reason and never sent. Noise the product chose to hold. */
    suppressed: z.number().int(),
    ruleKeys: z.array(z.string()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const at = input.now ? new Date(input.now) : new Date();
      // One implementation, shared with the Champion's hourly run (P4-T05a).
      const result = await runDueNudgesInTx(tx as WorkspaceTx, {
        workspaceId,
        at,
      });

      return {
        result,
        activity: {
          kind: "nudges.run",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { recorded: result.recorded },
        },
        audit: {
          action: "nudges.run",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { recorded: result.recorded },
        },
      };
    },
  }),
});

export const listNudges = defineReadAction({
  name: "nudges.list",
  summary:
    "This member's nudges, newest first, with the rule that caused each one.",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  output: z.object({
    nudges: z.array(
      z.object({
        id: z.uuid(),
        ruleKey: z.string(),
        subjectType: z.string(),
        subjectId: z.uuid(),
        channel: z.string(),
        escalationStep: z.number().int(),
        kind: z.string(),
        suppressedReason: z.string().nullable(),
        sentAt: z.string().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      return { nudges: [] };
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as WorkspaceTx;
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
        const memberId = member?.id;
        if (!memberId) {
          return { nudges: [] };
        }
        const rows = await tx
          .select({
            id: nudges.id,
            ruleKey: nudges.ruleKey,
            kind: nudges.kind,
            subjectType: nudges.subjectType,
            subjectId: nudges.subjectId,
            channel: nudges.channel,
            escalationStep: nudges.escalationStep,
            suppressedReason: nudges.suppressedReason,
            sentAt: nudges.sentAt,
            createdAt: nudges.createdAt,
          })
          .from(nudges)
          .where(
            activeOnly(
              nudges,
              and(
                eq(nudges.workspaceId, context.workspaceId),
                eq(nudges.recipientMemberId, memberId),
              ),
            ),
          )
          .orderBy(desc(nudges.createdAt))
          .limit(input.limit);

        return {
          nudges: rows.map((row) => ({
            ...row,
            sentAt: row.sentAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
          })),
        };
      },
    );
  },
});

/**
 * Snooze one subject for this member (P4-T04c).
 *
 * **A snooze silences the nudge and never the obligation.** METHOD.md and
 * CLAUDE.md both say it in one sentence, and the distinction is the whole point:
 * the review inbox is a list of what somebody owes, and a person choosing not to
 * be messaged about it has not stopped owing it. So this writes to the nudge and
 * touches nothing in the inbox.
 *
 * Per subject rather than per rule. Somebody snoozing a goal means "stop telling
 * me about this goal", not "stop telling me about check-ins", and a rule-level
 * snooze would silence a different goal they still care about.
 */
export const snoozeNudge = defineWriteAction({
  name: "nudges.snooze",
  summary:
    "Silences nudges about one subject for this member until a time they choose. Never silences the obligation itself.",
  input: z.object({
    nudgeId: z.uuid(),
    /** When it starts speaking again. */
    until: z.string(),
  }),
  output: z.object({ nudgeId: z.uuid(), until: z.string() }),
  // `comment` rather than `view`: no write is reachable at view, whatever its
  // domain, and this one writes. It is the lowest level above it, which is
  // right for an action that changes what the product says to you and nothing
  // about the work itself.
  access: ACCESS_LEVELS.comment,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const userId = context.actor.userId;
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

      const [nudge] = await tx
        .select({
          id: nudges.id,
          subjectType: nudges.subjectType,
          subjectId: nudges.subjectId,
          recipientMemberId: nudges.recipientMemberId,
        })
        .from(nudges)
        .where(
          activeOnly(
            nudges,
            eq(nudges.id, input.nudgeId),
            eq(nudges.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      // Not found rather than forbidden for somebody else's nudge, the way every
      // other read in the product refuses: an outsider learns nothing about what
      // exists.
      if (!nudge || nudge.recipientMemberId !== member.id) {
        throw new OperationError("not_found", "No such nudge.");
      }

      const until = new Date(input.until);
      // openokr:allow-mutation: the calling Operation's own transaction.
      await tx
        .update(nudges)
        .set({ snoozedUntil: until, updatedAt: new Date() })
        .where(
          activeOnly(
            nudges,
            eq(nudges.workspaceId, workspaceId),
            eq(nudges.recipientMemberId, member.id),
            eq(nudges.subjectType, nudge.subjectType),
            eq(nudges.subjectId, nudge.subjectId),
          ),
        );

      return {
        result: { nudgeId: input.nudgeId, until: until.toISOString() },
        activity: {
          kind: "nudge.snoozed",
          subjectType: "nudge",
          subjectId: input.nudgeId,
          payload: { until: until.toISOString() },
        },
        audit: {
          action: "nudges.snooze",
          targetType: "nudge",
          targetId: input.nudgeId,
          payload: { until: until.toISOString() },
        },
      };
    },
  }),
});

/**
 * The noisiest rules, for the workspace admin volume card (screen S-36).
 *
 * Behind `manage_coaching`, which is `full`: this is the view that tells an
 * administrator their product is annoying people, and the numbers name members.
 * The read is `full` for the same reason the strictness control is.
 */
export const nudgeVolume = defineReadAction({
  name: "nudges.volume",
  summary:
    "How many nudges each rule produced over a window, and how many were suppressed and why.",
  input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
  output: z.object({
    windowDays: z.number().int(),
    ceilingPerWeek: z.number().int(),
    rules: z.array(
      z.object({
        ruleKey: z.string(),
        sent: z.number().int(),
        suppressed: z.number().int(),
      }),
    ),
    /** Members over the §11 weekly ceiling, worst first. */
    loudestMembers: z.array(
      z.object({
        memberId: z.uuid(),
        name: z.string(),
        sentThisWeek: z.number().int(),
      }),
    ),
    suppressionReasons: z.array(
      z.object({ reason: z.string(), count: z.number().int() }),
    ),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as WorkspaceTx;
        const since = new Date(Date.now() - input.days * 86_400_000);
        const weekAgo = new Date(Date.now() - 7 * 86_400_000);
        const { thresholds } = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );

        const byRule = await tx
          .select({
            ruleKey: nudges.ruleKey,
            sent: count(nudges.sentAt),
            total: count(nudges.id),
          })
          .from(nudges)
          .where(
            activeOnly(
              nudges,
              and(
                eq(nudges.workspaceId, context.workspaceId),
                gte(nudges.scheduledFor, since),
              ),
            ),
          )
          .groupBy(nudges.ruleKey);

        const byReason = await tx
          .select({
            reason: nudges.suppressedReason,
            total: count(nudges.id),
          })
          .from(nudges)
          .where(
            activeOnly(
              nudges,
              and(
                eq(nudges.workspaceId, context.workspaceId),
                gte(nudges.scheduledFor, since),
                isNotNull(nudges.suppressedReason),
              ),
            ),
          )
          .groupBy(nudges.suppressedReason);

        const byMember = await tx
          .select({
            memberId: nudges.recipientMemberId,
            name: workspaceMembers.name,
            sent: count(nudges.id),
          })
          .from(nudges)
          .innerJoin(
            workspaceMembers,
            eq(workspaceMembers.id, nudges.recipientMemberId),
          )
          .where(
            activeOnly(
              nudges,
              and(
                eq(nudges.workspaceId, context.workspaceId),
                isNotNull(nudges.sentAt),
                gte(nudges.scheduledFor, weekAgo),
              ),
            ),
          )
          .groupBy(nudges.recipientMemberId, workspaceMembers.name);

        const ceiling = thresholds["cadence.nudgeCeilingPerWeek"];
        return {
          windowDays: input.days,
          ceilingPerWeek: ceiling,
          rules: byRule
            .map((row) => ({
              ruleKey: row.ruleKey,
              sent: row.sent,
              suppressed: row.total - row.sent,
            }))
            // Noisiest first, which is the question the card answers.
            .sort((a, b) => b.sent + b.suppressed - (a.sent + a.suppressed)),
          loudestMembers: byMember
            .filter((row) => row.sent > ceiling)
            .map((row) => ({
              memberId: row.memberId,
              name: row.name,
              sentThisWeek: row.sent,
            }))
            .sort((a, b) => b.sentThisWeek - a.sentThisWeek),
          suppressionReasons: byReason
            .map((row) => ({
              reason: row.reason ?? "unknown",
              count: row.total,
            }))
            .sort((a, b) => b.count - a.count),
        };
      },
    );
  },
});
