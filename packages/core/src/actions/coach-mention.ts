/**
 * The Coach answers a mention on a goal (plan 0.7.0 A8).
 *
 * AI-NATIVE-PLAN §6.5, "Conversation": "Mention the Coach on a goal and it
 * reviews that goal and replies in the thread." Approved 9 November 2026 as a
 * new proactive message, `quality.review_requested`.
 *
 * | Piece | What it is |
 * |---|---|
 * | Trigger | The comment that mentions the Coach enqueues `agents.coach.mentioned` in its own transaction (`agents/coach-mention.ts`) |
 * | Who runs this | The relay, as the Coach's agent member (`agents/coach-mention-run.ts`) |
 * | The review | METHOD.md §4.1 and §4.2 on the goal and its key results, from `evaluateGoalInTx`. No provider |
 * | The reply | A comment on the goal, answering the one that asked, authored by the Coach |
 * | The record | One `quality.review_requested` nudge to whoever asked, through the run's own suppression and delivery |
 *
 * **Least privilege, twice.** `load` reads the goal through the Coach's own
 * bindings (`agentSeesGoal`, the scope every Coach reader uses) and answers
 * not-found for a goal it cannot see, so nothing is read, written or said and
 * the relay records a skip. The refusal never names the goal. Then the
 * pipeline's floor is measured at `view` on the goal's space (or on the goal,
 * for one in no space, which the Coach is bound to by name), against the
 * Coach's own level, which comes only from those bindings. A goal's own access
 * context carries its space's groups and not the agents', which is why the
 * floor is measured on the space rather than on the goal.
 *
 * **The reply is the answer; the nudge is the ping.** Somebody who asked in a
 * thread is answered in it, every time. Whether they are also told on their
 * channel is the nudge's decision, so one already told about this goal today
 * is not told twice, and quiet hours, the ceiling, a snooze and leave hold as
 * for every other message.
 */
import {
  activeOnly,
  agents,
  comments,
  goals,
  keyResults,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { coachInTx } from "../agents/coach.ts";
import {
  coachReviewDocument,
  coachReviewPoints,
} from "../agents/coach-review.ts";
import { agentSeesGoal } from "../agents/scope.ts";
import { createComment } from "../comments/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import { resolveRhythmWithLadders } from "../nudges/ladders.ts";
import { recordAndDeliverInTx } from "../nudges/run.ts";
import { OperationError } from "../operations/operation.ts";
import { evaluateGoalInTx } from "../quality/service.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";
import { extractMentionIds } from "../rich-text/extract.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/** The rule the reply's nudge cites. A key the catalogue defines. */
const RULE = "quality.review_requested" as const;

export const answerCoachMention = defineWriteAction({
  name: "agents.answerMention",
  summary:
    "The Coach reviews the goal a comment mentioned it on, and replies in that thread.",
  // Only the relay calls this, as the Coach. No agent is offered it as a tool.
  agentSurface: false,
  input: z.object({
    commentId: z.uuid(),
    goalId: z.uuid(),
    /** The goal's space as the comment saw it, or null for none. */
    spaceId: z.uuid().nullable(),
  }),
  output: z.object({
    /** The Coach's reply. */
    commentId: z.uuid(),
    /** The check keys the reply raises, worst first. */
    ruleKeys: z.array(z.string()),
  }),
  // Declared at `full` so no person reaches it by holding less. The floor the
  // pipeline enforces is the Coach's own level where it is bound, below.
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    requires: ACCESS_LEVELS.view,
    subject: input.spaceId
      ? { type: "space", id: input.spaceId }
      : { type: "goal", id: input.goalId },
    async load({ tx, workspaceId, actor }) {
      const coach = await coachInTx(tx as WorkspaceTx, workspaceId);
      // Nobody answers for the Coach: not a person, not another agent.
      if (
        !coach ||
        actor.kind !== "agent" ||
        actor.memberId !== coach.memberId
      ) {
        throw new OperationError(
          "forbidden",
          "Only the OKR Coach answers a mention of itself.",
        );
      }
      const [agent] = await tx
        .select({ enabled: agents.enabled, autonomy: agents.autonomy })
        .from(agents)
        .where(activeOnly(agents, eq(agents.id, coach.agentId)))
        .limit(1);
      if (!agent?.enabled) {
        throw new OperationError("conflict", "The Coach is turned off.");
      }
      // Sandbox mode commits nothing at all, and a reply is a commit.
      if (agent.autonomy === "sandbox") {
        throw new OperationError(
          "conflict",
          "The Coach is in sandbox mode, so it posts nothing.",
        );
      }

      // Through the Coach's own bindings, never the asker's. Not-found for a
      // goal it cannot see, for one that is gone, and for one moved to another
      // space since the comment, whose floor would be measured on the wrong
      // space: one answer, so none of them is an oracle.
      const [goal] = await tx
        .select({ spaceId: goals.spaceId })
        .from(goals)
        .where(
          activeOnly(
            goals,
            eq(goals.workspaceId, workspaceId),
            eq(goals.id, input.goalId),
            agentSeesGoal({ memberId: coach.memberId }),
          ),
        )
        .limit(1);
      if (!goal || goal.spaceId !== input.spaceId) {
        throw new OperationError("not_found", "There is no such goal.");
      }

      const [comment] = await tx
        .select({
          authorMemberId: comments.authorMemberId,
          body: comments.body,
        })
        .from(comments)
        .where(
          activeOnly(
            comments,
            eq(comments.workspaceId, workspaceId),
            eq(comments.id, input.commentId),
            eq(comments.subjectType, "goal"),
            eq(comments.subjectId, input.goalId),
          ),
        )
        .limit(1);
      if (
        !comment ||
        comment.authorMemberId === coach.memberId ||
        !extractMentionIds(comment.body).includes(coach.memberId)
      ) {
        // Deleted since, edited to drop the mention, or never one.
        throw new OperationError("not_found", "There is no such mention.");
      }

      // One answer per comment. The relay delivers at least once, and an edit
      // that mentions the Coach again is the same question.
      const [answered] = await tx
        .select({ id: comments.id })
        .from(comments)
        .where(
          activeOnly(
            comments,
            eq(comments.workspaceId, workspaceId),
            eq(comments.parentId, input.commentId),
            eq(comments.authorMemberId, coach.memberId),
          ),
        )
        .limit(1);
      if (answered) {
        throw new OperationError(
          "conflict",
          "The Coach has already answered this comment.",
        );
      }

      return { coach, askedBy: comment.authorMemberId };
    },
    async execute({ tx, workspaceId, loaded }) {
      const wtx = tx as WorkspaceTx;
      const at = new Date();
      const verdicts = await evaluateGoalInTx(wtx, {
        workspaceId,
        goalId: input.goalId,
      });
      if (!verdicts) {
        throw new OperationError("not_found", "There is no such goal.");
      }
      const titles =
        verdicts.keyResultIds.length === 0
          ? []
          : await tx
              .select({ id: keyResults.id, title: keyResults.title })
              .from(keyResults)
              .where(
                activeOnly(
                  keyResults,
                  and(
                    eq(keyResults.workspaceId, workspaceId),
                    inArray(keyResults.id, [...verdicts.keyResultIds]),
                  ),
                ),
              );
      const points = coachReviewPoints(
        verdicts,
        new Map(titles.map((row) => [row.id, row.title])),
      );
      const body = coachReviewDocument(points);

      const reply = await createComment(wtx, {
        workspaceId,
        subjectType: "goal",
        subjectId: input.goalId,
        authorMemberId: loaded.coach.memberId,
        body,
        parentId: input.commentId,
      });

      // The message, through the same suppression and delivery as every
      // other one. `isTriggerKey` is checked again when the row is written.
      const thresholds = await resolveRhythmWithLadders(
        wtx,
        workspaceId,
        resolveRhythm(await readRhythmRow(wtx, workspaceId)),
      );
      const { decided } = await recordAndDeliverInTx(wtx, {
        workspaceId,
        at,
        timeZone: await workspaceTimeZone(wtx, workspaceId),
        thresholds,
        due: [
          {
            ruleKey: RULE,
            // The Coach's remit, as §6.4's quality table puts it.
            kind: "quality",
            subjectType: "goal",
            subjectId: input.goalId,
            recipientMemberId: loaded.askedBy,
            channel: "in_app",
            escalationStep: 0,
            // An answer to the person who asked, never an escalation past
            // anybody, so it waits out their quiet hours like anything else.
            urgent: false,
          },
        ],
        ...(context.baseUrl ? { baseUrl: context.baseUrl } : {}),
        ...(context.instanceName ? { instanceName: context.instanceName } : {}),
      });
      const told = decided.find((entry) => entry.nudge.ruleKey === RULE);

      const ruleKeys = points.map((point) => point.ruleKey);
      return {
        result: { commentId: reply.id, ruleKeys },
        activity: {
          kind: "comment.created" as const,
          subjectType: "comment",
          subjectId: reply.id,
          payload: {
            subjectType: "goal",
            excerpt: excerptRichText(body, 120),
          },
        },
        audit: {
          action: "agents.answerMention",
          targetType: "comment",
          targetId: reply.id,
          payload: {
            goalId: input.goalId,
            answering: input.commentId,
            ruleKeys,
            // Null when the ping went out or waits out quiet hours; else why
            // it did not, and `not_recorded` for an asker no longer active.
            // The reply was posted either way.
            nudgeSuppressed: told ? told.suppressedReason : "not_recorded",
          },
        },
      };
    },
  }),
});

/**
 * The agents a mention gets an answer from, for the comment composer's `@`
 * (plan 0.7.0 A8).
 *
 * The composer offers people and guests, because a mention tells the person
 * named and an agent would be told nothing. The Coach now answers, so it is
 * offered too, while it is turned on. The Champion is not: nothing reacts to a
 * mention of it, and offering it would promise a reply that never comes.
 */
export const mentionableAgents = defineReadAction({
  name: "agents.mentionable",
  summary:
    "The agents a comment can mention and get an answer from: the Coach, while it is on.",
  // The composer's list. An agent connection finds the Coach's member in
  // `people.directory`, like any other member it might mention.
  agentSurface: false,
  input: z.object({}),
  output: z.array(z.object({ id: z.uuid(), name: z.string() })),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const coach = await coachInTx(tx, context.workspaceId);
      if (!coach) {
        return [];
      }
      const [row] = await tx
        .select({ name: workspaceMembers.name, enabled: agents.enabled })
        .from(agents)
        .innerJoin(workspaceMembers, eq(workspaceMembers.id, agents.memberId))
        .where(
          activeOnly(
            agents,
            eq(agents.id, coach.agentId),
            eq(workspaceMembers.status, "active"),
          ),
        )
        .limit(1);
      return row?.enabled ? [{ id: coach.memberId, name: row.name }] : [];
    });
  },
});
