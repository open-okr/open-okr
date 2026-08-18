import {
  activeOnly,
  notifications,
  nudges,
  type WorkspaceTx,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import {
  activeMemberIds,
  dueCheckInNudges,
  recordNudgesInTx,
} from "../nudges/service.ts";
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
    ruleKeys: z.array(z.string()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const at = input.now ? new Date(input.now) : new Date();
      const { thresholds } = resolveRhythm(
        await readRhythmRow(tx, workspaceId),
      );
      const timeZone = await workspaceTimeZone(tx, workspaceId);

      const due = await dueCheckInNudges(tx as WorkspaceTx, {
        workspaceId,
        now: at,
        timeZone,
        thresholds,
      });

      // A suspended member is never nudged. §4.3's access getter excludes them
      // from every read, and a nudge to somebody who cannot open the product is
      // an email to a former colleague.
      const active = await activeMemberIds(tx as WorkspaceTx, workspaceId);
      const deliverable = due.filter((entry) =>
        active.has(entry.recipientMemberId),
      );

      const ids = await recordNudgesInTx(tx as WorkspaceTx, {
        workspaceId,
        due: deliverable,
        at,
      });

      // The in-app inbox, one row per nudge, linked by the `nudge_id` the
      // notifications table has carried since 0013 with nothing to point at.
      for (const [index, nudgeId] of ids.entries()) {
        const entry = deliverable[index];
        if (!entry) {
          continue;
        }
        // openokr:allow-mutation: the calling Operation's own transaction.
        await tx.insert(notifications).values({
          workspaceId,
          recipientMemberId: entry.recipientMemberId,
          nudgeId,
          // `check_in` is the reason every nudge this task produces carries,
          // because every one of them is about a check-in. When P4-T04c adds
          // blockers and KPI corridors the reason list grows with them rather
          // than being widened speculatively now.
          reason: "check_in",
          channel: entry.channel,
          sentAt: at,
        });
      }

      return {
        result: {
          recorded: ids.length,
          ruleKeys: [...new Set(deliverable.map((entry) => entry.ruleKey))],
        },
        activity: {
          kind: "nudges.run",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { recorded: ids.length },
        },
        audit: {
          action: "nudges.run",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { recorded: ids.length },
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
