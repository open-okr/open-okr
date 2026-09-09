import {
  activeOnly,
  nudgeRules,
  nudges,
  proposedChanges,
  rhythmSettings,
  type WorkspaceTx,
  withContext,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import {
  isTriggerKey,
  type ResolvedThresholds,
  TRIGGER_CATALOGUE,
} from "@openokr/method";
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import {
  LADDER_OWNERS,
  ladderOwnerFor,
  ladderProblem,
} from "../nudges/ladders.ts";
import { runDueNudgesInTx } from "../nudges/run.ts";
import { OperationError } from "../operations/errors.ts";
import { primaryChannelSchema } from "../settings/registry.ts";
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
    "Computes what is due for every member, records a nudge row for each, and delivers what is due to the inbox and the member's own channel.",
  input: z.object({
    /** Defaults to the moment the request arrives. Overridden by tests and backfills. */
    now: z.string().optional(),
  }),
  output: z.object({
    recorded: z.number().int(),
    /**
     * Routed and stamped as sent on this pass (P5-T01b-b).
     *
     * Not the same number as `recorded`: a nudge written inside its
     * recipient's quiet hours is recorded now and delivered by a later run,
     * and one an earlier run deferred is delivered here without being
     * recorded again.
     */
    delivered: z.number().int(),
    /** Of those, the ones that went to a provider rather than in-app only. */
    toChannel: z.number().int(),
    /** Written with a reason and never sent. Noise the product chose to hold. */
    suppressed: z.number().int(),
    ruleKeys: z.array(z.string()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const at = input.now ? new Date(input.now) : new Date();
      // One implementation, shared with the Champion's hourly run (P4-T05a).
      // This action stays the hourly queue: it is what P4-T04a built and what
      // `nudges.run` means to every caller. The other three cadences are the
      // Champion's, reachable through `agents.runChampion`, because a run that
      // swept staleness under the name "run the nudges" would write to goals
      // from an action nobody expected to.
      // `staleFlipped` and `proposed` are dropped rather than reported: this
      // action runs the hourly queue, which sweeps nothing and, with no agent
      // run to hang a proposal off, proposes nothing either.
      const {
        staleFlipped: _sweep,
        proposed: _proposed,
        diverged: _diverged,
        reviewed: _reviewed,
        ruleKeys,
        ...counts
      } = await runDueNudgesInTx(tx as WorkspaceTx, {
        workspaceId,
        at,
        cadence: "hourly",
      });
      const result = { ...counts, ruleKeys: [...ruleKeys] };

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
        /**
         * The change this nudge offers, when it offers one (P4-T05c-a).
         *
         * Null on almost every nudge: a reminder to do something yourself
         * carries no draft. Present, it is what makes "review and apply in one
         * action" possible from the inbox, because the id here is the id
         * `proposals.bulkApply` takes.
         */
        proposal: z
          .object({
            id: z.uuid(),
            action: z.string(),
            status: z.string(),
            /** False for a template. True only where a model wrote it. */
            aiGenerated: z.boolean(),
          })
          .nullable(),
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
            proposalId: nudges.proposalId,
            proposalAction: proposedChanges.action,
            proposalStatus: proposedChanges.status,
            proposalAiGenerated: proposedChanges.aiGenerated,
            suppressedReason: nudges.suppressedReason,
            sentAt: nudges.sentAt,
            createdAt: nudges.createdAt,
          })
          .from(nudges)
          // Left, because most nudges carry no proposal and an inner join
          // would silently return only the ones that do.
          .leftJoin(proposedChanges, eq(proposedChanges.id, nudges.proposalId))
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
          nudges: rows.map(
            ({
              proposalId,
              proposalAction,
              proposalStatus,
              proposalAiGenerated,
              ...row
            }) => ({
              ...row,
              sentAt: row.sentAt?.toISOString() ?? null,
              createdAt: row.createdAt.toISOString(),
              proposal:
                proposalId && proposalAction && proposalStatus
                  ? {
                      id: proposalId,
                      action: proposalAction,
                      status: proposalStatus,
                      aiGenerated: proposalAiGenerated ?? false,
                    }
                  : null,
            }),
          ),
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

/**
 * Every §6.4 rule with what this workspace has decided about it (S-36,
 * P6-G21).
 *
 * **Enumerated from the catalogue, not from the table.** `nudge_rules` holds
 * one row per rule a workspace has changed its mind about, and its own comment
 * says the absence of a row is the canon default. A read that listed the table
 * would show a fresh workspace nothing at all, which is the opposite of what
 * this card is for.
 *
 * The volume comes from the nudge rows themselves and is the argument for
 * turning a rule down: "this one sent forty-one messages last week" is the
 * sentence that makes the decision, not the rule's name.
 */

/**
 * What the rules screen shows for a ladder (P6-G21b).
 *
 * Null for the twenty-one triggers that own no ladder, so the card renders
 * nothing rather than an empty editor. `own` is what the workspace stored and
 * is null when it stored nothing, which is what lets the screen say "§11's"
 * instead of showing the canon as though somebody had typed it.
 */
function ladderFor(
  ruleKey: string,
  canon: ResolvedThresholds,
  stored: Record<string, number> | null | undefined,
): {
  rungs: string[];
  canon: Record<string, number>;
  own: Record<string, number> | null;
  governs: string[];
} | null {
  const owner = ladderOwnerFor(ruleKey);
  if (!owner) {
    return null;
  }
  return {
    rungs: [...owner.rungs],
    canon: canon[owner.threshold] as unknown as Record<string, number>,
    // Shown only when it is readable. A row an older release wrote is one the
    // reader is not being asked to confirm, and `resolveLadder` is already
    // ignoring it everywhere else.
    own:
      stored && ladderProblem(owner, stored) === null
        ? (stored as Record<string, number>)
        : null,
    governs: [...owner.governs],
  };
}

export const listNudgeRules = defineReadAction({
  name: "nudges.rules",
  summary:
    "Every rule in the METHOD.md §6.4 catalogue with this workspace's configuration and its recent volume.",
  input: z.object({}),
  output: z.object({
    /** Whether the workspace is holding every non-exempt rule quiet. */
    quietMode: z.boolean(),
    rules: z.array(
      z.object({
        key: z.string(),
        /** §6.4's own words for when it fires and who hears it. */
        fires: z.string(),
        recipient: z.string(),
        escalates: z.boolean(),
        deterministic: z.boolean(),
        enabled: z.boolean(),
        channelOverride: z.string().nullable(),
        quietModeExempt: z.boolean(),
        /**
         * The §11 ladder this rule owns, if it owns one (P6-G21b).
         *
         * Absent on the twenty-one rules that own none. Present on the three
         * that do, carrying the canon, whatever the workspace has put in its
         * place, and the other triggers the one ladder decides, so the card
         * can say what a change here reaches.
         */
        ladder: z
          .object({
            rungs: z.array(z.string()),
            canon: z.record(z.string(), z.number()),
            own: z.record(z.string(), z.number()).nullable(),
            governs: z.array(z.string()),
          })
          .nullable(),
        /** Whether this workspace has changed anything about it. */
        configured: z.boolean(),
        /** Sent in the last seven days. */
        sent: z.number().int(),
        /** Suppressed in the last seven days, whatever the reason. */
        suppressed: z.number().int(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const [settings] = await tx
        .select({ quietMode: rhythmSettings.quietMode })
        .from(rhythmSettings)
        .where(eq(rhythmSettings.workspaceId, context.workspaceId))
        .limit(1);

      const configured = await tx
        .select({
          ruleKey: nudgeRules.ruleKey,
          enabled: nudgeRules.enabled,
          channelOverride: nudgeRules.channelOverride,
          quietModeExempt: nudgeRules.quietModeExempt,
          escalationLadder: nudgeRules.escalationLadder,
        })
        .from(nudgeRules)
        .where(
          activeOnly(
            nudgeRules,
            eq(nudgeRules.workspaceId, context.workspaceId),
          ),
        );
      const byKey = new Map(configured.map((row) => [row.ruleKey, row]));

      // §11's own numbers, after any workspace override of the *thresholds*
      // themselves (P6-G20). A ladder override sits on top of that, so a
      // workspace that changed both sees its own answer in both places.
      const canon = resolveRhythm(
        await readRhythmRow(tx, context.workspaceId),
      ).thresholds;

      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const volume = await tx
        .select({
          ruleKey: nudges.ruleKey,
          sent: sql<number>`count(*) filter (where ${nudges.sentAt} is not null)::int`,
          suppressed: sql<number>`count(*) filter (where ${nudges.suppressedReason} is not null)::int`,
        })
        .from(nudges)
        .where(
          activeOnly(
            nudges,
            eq(nudges.workspaceId, context.workspaceId),
            gte(nudges.scheduledFor, weekAgo),
          ),
        )
        .groupBy(nudges.ruleKey);
      const counts = new Map(volume.map((row) => [row.ruleKey, row]));

      return {
        quietMode: settings?.quietMode ?? false,
        rules: TRIGGER_CATALOGUE.map((trigger) => {
          const row = byKey.get(trigger.key);
          const seen = counts.get(trigger.key);
          return {
            key: trigger.key,
            fires: trigger.fires,
            recipient: trigger.recipient,
            escalates: trigger.escalates,
            deterministic: trigger.deterministic,
            // No row is the canon default, which is enabled on the member's
            // own channel with §11's ladder.
            enabled: row?.enabled ?? true,
            channelOverride: row?.channelOverride ?? null,
            quietModeExempt: row?.quietModeExempt ?? false,
            ladder: ladderFor(trigger.key, canon, row?.escalationLadder),
            configured: row !== undefined,
            sent: Number(seen?.sent ?? 0),
            suppressed: Number(seen?.suppressed ?? 0),
          };
        }),
      };
    });
  },
});

/**
 * Turns one rule down, or back up (S-36, P6-G21).
 *
 * **A row is written only when the workspace differs from the canon**, and
 * removed when it stops differing. `nudge_rules`' own comment is that the
 * absence of a row is the default, and a row that matches the canon would
 * survive a change to the canon and quietly hold the old answer, which is the
 * same trap the §11 override map avoids.
 */
export const setNudgeRule = defineWriteAction({
  name: "nudges.setRule",
  summary: "Enables, mutes, re-routes or exempts one §6.4 rule.",
  input: z.object({
    ruleKey: z.string().min(1),
    enabled: z.boolean().optional(),
    /** Null returns this rule to the member's own primary channel. */
    channelOverride: primaryChannelSchema.nullable().optional(),
    quietModeExempt: z.boolean().optional(),
    /**
     * This workspace's own §11 ladder, for the rule that owns one (P6-G21b).
     *
     * Null returns the rule to the canon. Typed loosely here and checked
     * against the threshold registry's own schema in the handler, because the
     * three ladders have three shapes and the registry is what defines them.
     * A second copy of those shapes in this file is a second thing to keep in
     * step with §11.
     */
    escalationLadder: z.record(z.string(), z.number()).nullable().optional(),
  }),
  output: z.object({ ruleKey: z.string(), configured: z.boolean() }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      if (!isTriggerKey(input.ruleKey)) {
        throw new OperationError(
          "not_found",
          `\`${input.ruleKey}\` is not a rule the method package defines.`,
        );
      }

      const ladderOwner = ladderOwnerFor(input.ruleKey);
      if (input.escalationLadder !== undefined) {
        if (!ladderOwner) {
          throw new OperationError(
            // The idiom `rhythm.update` set for a value §11 would not accept.
            "forbidden",
            input.ruleKey +
              " does not own a ladder. §11 defines three, and each is set " +
              "on the rule it escalates to: " +
              LADDER_OWNERS.map((owner) => owner.ruleKey).join(", ") +
              ".",
          );
        }
        if (input.escalationLadder !== null) {
          const problem = ladderProblem(ladderOwner, input.escalationLadder);
          if (problem) {
            throw new OperationError("forbidden", problem);
          }
        }
      }

      const [existing] = await tx
        .select({
          id: nudgeRules.id,
          enabled: nudgeRules.enabled,
          channelOverride: nudgeRules.channelOverride,
          quietModeExempt: nudgeRules.quietModeExempt,
          escalationLadder: nudgeRules.escalationLadder,
        })
        .from(nudgeRules)
        .where(
          activeOnly(
            nudgeRules,
            eq(nudgeRules.workspaceId, workspaceId),
            eq(nudgeRules.ruleKey, input.ruleKey),
          ),
        )
        .limit(1);

      const next = {
        enabled: input.enabled ?? existing?.enabled ?? true,
        channelOverride:
          input.channelOverride !== undefined
            ? input.channelOverride
            : (existing?.channelOverride ?? null),
        quietModeExempt:
          input.quietModeExempt ?? existing?.quietModeExempt ?? false,
        escalationLadder:
          input.escalationLadder !== undefined
            ? input.escalationLadder
            : (existing?.escalationLadder ?? null),
      };

      // Back to the canon in every respect: the row goes rather than being
      // kept as a copy of the default.
      // Back to the canon in every respect includes the ladder: a row kept
      // only to hold a copy of §11's numbers would survive a change to §11.
      const isCanon =
        next.enabled &&
        next.channelOverride === null &&
        !next.quietModeExempt &&
        next.escalationLadder === null;

      if (isCanon) {
        if (existing) {
          // openokr:allow-mutation: this is the operation's own execute.
          await tx
            .update(nudgeRules)
            .set({ deletedAt: new Date() })
            .where(activeOnly(nudgeRules, eq(nudgeRules.id, existing.id)));
        }
        return {
          result: { ruleKey: input.ruleKey, configured: false },
          activity: {
            kind: "nudge.rule_changed",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: { ruleKey: input.ruleKey, configured: false },
          },
          audit: {
            action: "nudges.setRule",
            targetType: "workspace",
            targetId: workspaceId,
            payload: { ruleKey: input.ruleKey, ...next },
          },
        };
      }

      if (existing) {
        // openokr:allow-mutation: this is the operation's own execute.
        await tx
          .update(nudgeRules)
          .set({ ...next, updatedAt: new Date() })
          .where(activeOnly(nudgeRules, eq(nudgeRules.id, existing.id)));
      } else {
        // openokr:allow-mutation: this is the operation's own execute.
        await tx.insert(nudgeRules).values({
          workspaceId,
          ruleKey: input.ruleKey,
          ...next,
        });
      }

      return {
        result: { ruleKey: input.ruleKey, configured: true },
        activity: {
          kind: "nudge.rule_changed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { ruleKey: input.ruleKey, configured: true },
        },
        audit: {
          action: "nudges.setRule",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { ruleKey: input.ruleKey, ...next },
        },
      };
    },
  }),
});
