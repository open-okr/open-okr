/**
 * The review inbox (UIUX-PLAN.md §4 S-02, TECHNICAL-PLAN §14, P3-T08).
 *
 * One read, and everything on the screen comes from it: the grouped list, the
 * counts across the top and the sidebar badge. They cannot disagree with each
 * other because there is nothing for them to disagree about.
 *
 * Two rules decide who owes what, and both are already settled elsewhere.
 * METHOD.md §2.5 puts the check-in on the champion, so a check-in obligation is
 * never offered to a reviewer or an administrator however much access they hold.
 * And the acknowledgement belongs to the reviewer **of record**, the member
 * named on the check-in at publication, not whoever reviews the goal today.
 *
 * Access is checked per goal through the same getter every other read uses, so a
 * goal the member cannot see cannot reach their inbox even if a role column
 * still points at them.
 */
import {
  activeOnly,
  blockers,
  checkIns,
  commitments,
  goals,
  keyResultDependencies,
  keyResults,
  kpis,
  okrSessions,
  proposedChanges,
  spaces,
  taskAssignees,
  tasks,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { and, asc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import { daysPastDue, dueLocalDate } from "../cadence/service.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow, workspaceTimeZone } from "../cycles/service.ts";
import { resolveRhythmWithLadders } from "../nudges/ladders.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import {
  acknowledgementDueLabel,
  acknowledgementGroup,
  countObligations,
  dueLabelFor,
  groupFor,
  type Obligation,
  PENDING_SOURCES,
  publishedAgo,
  sortObligations,
} from "../review/obligations.ts";
import {
  canReach,
  mayDecideProposal,
  proposalHeadline,
  proposalPreview,
  proposalRecipients,
} from "../review/proposals.ts";
import { defineReadAction } from "./define.ts";

const obligationSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "check_in",
    "acknowledgement",
    "blocker",
    "dependency",
    "commitment",
    "session",
    "proposal",
    "task",
  ]),
  group: z.enum(["overdue", "today", "this_week", "upcoming"]),
  title: z.string(),
  meta: z.string(),
  dueLabel: z.string(),
  dueOn: z.string().nullable(),
  daysPastDue: z.number().int().nullable(),
  href: z.string(),
  actionLabel: z.string(),
  subjectId: z.uuid(),
  checkInId: z.uuid().nullable(),
  /** Set on an agent proposal, so the row can be decided where it is listed. */
  proposal: z
    .object({
      id: z.uuid(),
      action: z.string(),
      aiGenerated: z.boolean(),
      preview: z.array(z.object({ label: z.string(), value: z.string() })),
    })
    .nullable(),
});

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

/** The Sunday-to-Saturday week a commitment's `week_start` opens. */
function endOfWeek(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 6);
  return start.toISOString().slice(0, 10);
}

/** True when this member may see this goal at all. Not-found means no. */
async function canSeeGoal(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  goalId: string,
): Promise<boolean> {
  try {
    await getAccessScoped(tx, {
      workspaceId,
      memberId,
      resourceType: "goal",
      resourceId: goalId,
      requires: ACCESS_LEVELS.view as never,
    });
    return true;
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      return false;
    }
    throw error;
  }
}

export const reviewInbox = defineReadAction({
  name: "review.inbox",
  summary:
    "What this member owes right now, overdue first. Drives screen S-02 and the sidebar badge.",
  input: z.object({}),
  output: z.object({
    obligations: z.array(obligationSchema),
    counts: z.object({
      overdue: z.number().int(),
      today: z.number().int(),
      thisWeek: z.number().int(),
      upcoming: z.number().int(),
      total: z.number().int(),
      actionable: z.number().int(),
    }),
    /** The S-02 sources no phase has built yet, named rather than hidden. */
    pending: z.array(
      z.object({
        kind: z.string(),
        label: z.string(),
        task: z.string(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (rawTx) => {
        const tx = rawTx as OperationTx;
        const memberId = await actingMember(tx, context.workspaceId, userId);
        const timeZone = await workspaceTimeZone(tx, context.workspaceId);
        const rhythm = resolveRhythm(
          await readRhythmRow(tx, context.workspaceId),
        );
        // The workspace's own acknowledgement ladder when it has replaced
        // §11's (P6-G21b). The column has been stored since P4-T04b and read
        // by nothing until this row.
        const thresholds = await resolveRhythmWithLadders(
          tx,
          context.workspaceId,
          rhythm,
        );
        const escalateAfter =
          thresholds["cadence.acknowledgementLadderDays"].escalate;
        const now = new Date();

        const obligations: Obligation[] = [];

        // Source 1: the check-ins this member owes as champion (METHOD.md §2.5).
        // A closed goal is never due, which is why `closed_at` is part of the
        // filter rather than something the caller remembers to check.
        const due = await tx
          .select({
            id: goals.id,
            title: goals.title,
            level: goals.level,
            health: goals.health,
            nextCheckInAt: goals.nextCheckInAt,
          })
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(goals.championId, memberId),
              isNull(goals.closedAt),
            ),
          )
          .orderBy(asc(goals.nextCheckInAt));

        for (const goal of due) {
          const days = daysPastDue(goal.nextCheckInAt, now, timeZone);
          if (days === null) {
            continue;
          }
          if (!(await canSeeGoal(tx, context.workspaceId, memberId, goal.id))) {
            continue;
          }
          const dueOn = dueLocalDate(goal.nextCheckInAt, timeZone);
          obligations.push({
            id: `check_in:${goal.id}`,
            kind: "check_in",
            group: groupFor(days),
            title: `Post your check-in on "${goal.title}"`,
            meta: `Champion · ${goal.level} · ${goal.health.replace("_", " ")}`,
            dueLabel: dueLabelFor(days, dueOn),
            dueOn,
            daysPastDue: days,
            href: `/check-in?goal=${goal.id}`,
            actionLabel: "Check in",
            subjectId: goal.id,
            checkInId: null,
            proposal: null,
          });
        }

        // Source 2: the acknowledgements owed as reviewer of record. The join is
        // on `reviewer_member_id`, never on `goals.reviewer_id`: a reassignment
        // moves the open ones and leaves the closed ones with whoever closed
        // them, so reading the goal here would hand a new reviewer somebody
        // else's finished work (design §4.4).
        const owed = await tx
          .select({
            id: checkIns.id,
            goalId: checkIns.subjectId,
            goalTitle: goals.title,
            publishedAt: checkIns.publishedAt,
            authorName: workspaceMembers.name,
          })
          .from(checkIns)
          .innerJoin(goals, eq(goals.id, checkIns.subjectId))
          .innerJoin(
            workspaceMembers,
            eq(workspaceMembers.id, checkIns.authorMemberId),
          )
          .where(
            and(
              activeOnly(
                checkIns,
                eq(checkIns.workspaceId, context.workspaceId),
                eq(checkIns.reviewerMemberId, memberId),
                eq(checkIns.state, "published"),
                isNull(checkIns.acknowledgedAt),
              ),
              isNull(goals.deletedAt),
            ),
          )
          .orderBy(asc(checkIns.publishedAt));

        for (const row of owed) {
          if (
            !(await canSeeGoal(tx, context.workspaceId, memberId, row.goalId))
          ) {
            continue;
          }
          const age = daysPastDue(row.publishedAt, now, timeZone) ?? 0;
          obligations.push({
            id: `acknowledgement:${row.id}`,
            kind: "acknowledgement",
            group: acknowledgementGroup(age, escalateAfter),
            title: `Acknowledge the check-in on "${row.goalTitle}"`,
            meta: `Reviewer · ${row.authorName} · ${publishedAgo(age)}`,
            dueLabel: acknowledgementDueLabel(age, escalateAfter),
            dueOn: dueLocalDate(row.publishedAt, timeZone),
            daysPastDue: age,
            href: `/check-in?goal=${row.goalId}`,
            actionLabel: "Acknowledge",
            subjectId: row.goalId,
            checkInId: row.id,
            proposal: null,
          });
        }

        // Source 3: the tasks assigned to this member with a due date and no
        // tick yet (P5-T11). Read through the task's own access context rather
        // than through a goal: a task lives in a space and its assignee holds
        // edit on it directly, so `canSeeGoal` is the wrong question here.
        const assigned = await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            dueOn: tasks.dueOn,
            status: tasks.status,
            spaceName: spaces.name,
          })
          .from(tasks)
          .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
          .innerJoin(spaces, eq(spaces.id, tasks.spaceId))
          .where(
            and(
              activeOnly(
                tasks,
                eq(tasks.workspaceId, context.workspaceId),
                isNotNull(tasks.dueOn),
                ne(tasks.status, "done"),
              ),
              eq(taskAssignees.memberId, memberId),
              isNull(taskAssignees.deletedAt),
            ),
          )
          .orderBy(asc(tasks.dueOn));

        for (const row of assigned) {
          if (!row.dueOn) {
            continue;
          }
          const days = daysPastDue(
            new Date(`${row.dueOn}T00:00:00Z`),
            now,
            timeZone,
          );
          if (days === null) {
            continue;
          }
          const allowed = await getAccessScoped(tx, {
            workspaceId: context.workspaceId,
            memberId,
            resourceType: "task",
            resourceId: row.id,
          }).then(
            () => true,
            () => false,
          );
          if (!allowed) {
            continue;
          }
          obligations.push({
            id: `task:${row.id}`,
            kind: "task",
            group: groupFor(days),
            title: `Finish "${row.title}"`,
            meta: `Assigned · ${row.spaceName} · ${row.status.replace("_", " ")}`,
            dueLabel: dueLabelFor(days, row.dueOn),
            dueOn: row.dueOn,
            daysPastDue: days,
            href: `/tasks/${row.id}`,
            actionLabel: "Open the task",
            subjectId: row.id,
            checkInId: null,
            proposal: null,
          });
        }

        // Source 4: the blockers this member owns, or had one escalated to
        // them (P3-T09, P4-T07c). Both, because an escalation is precisely an
        // obligation moving to somebody else, and a coordinator who is never
        // told is the failure this screen exists to prevent. `due_at` is not
        // null on the table, so a blocker always has a clock.
        const owned = await tx
          .select({
            id: blockers.id,
            type: blockers.type,
            description: blockers.description,
            dueAt: blockers.dueAt,
            goalId: blockers.goalId,
            goalTitle: goals.title,
            escalatedToId: blockers.escalatedToId,
          })
          .from(blockers)
          .leftJoin(goals, eq(goals.id, blockers.goalId))
          .where(
            and(
              activeOnly(
                blockers,
                eq(blockers.workspaceId, context.workspaceId),
                isNull(blockers.resolvedAt),
              ),
              or(
                eq(blockers.ownerId, memberId),
                eq(blockers.escalatedToId, memberId),
              ),
            ),
          )
          .orderBy(asc(blockers.dueAt));

        for (const row of owned) {
          const days = daysPastDue(row.dueAt, now, timeZone);
          if (days === null) {
            continue;
          }
          // A blocker hangs off a goal, so the goal decides who may see it. A
          // blocker with no goal is one raised against a key result whose goal
          // link was not set, and it is skipped rather than shown to somebody
          // the access model never approved.
          if (
            !row.goalId ||
            !(await canSeeGoal(tx, context.workspaceId, memberId, row.goalId))
          ) {
            continue;
          }
          const escalated = row.escalatedToId === memberId;
          obligations.push({
            id: `blocker:${row.id}`,
            kind: "blocker",
            group: groupFor(days),
            title: `Clear the blocker on "${row.goalTitle ?? "a key result"}"`,
            meta: `${escalated ? "Escalated to you" : "Owner"} · ${row.type.replace(/_/g, " ")}${
              row.description ? ` · ${row.description}` : ""
            }`,
            dueLabel: dueLabelFor(days, dueLocalDate(row.dueAt, timeZone)),
            dueOn: dueLocalDate(row.dueAt, timeZone),
            daysPastDue: days,
            href: `/goals/${row.goalId}`,
            actionLabel: "Open the blocker",
            subjectId: row.goalId,
            checkInId: null,
            proposal: null,
          });
        }

        // Source 4b: dependencies escalated to this member as the cycle's
        // sponsor (METHOD.md §5.4, P9-T16b-b), until the providing team
        // confirms or somebody is named to carry the risk. No deadline is
        // invented for the decision, so each one sits in today until it is
        // made.
        const escalatedToMe = await tx
          .select({
            id: keyResultDependencies.id,
            keyResultTitle: keyResults.title,
            goalId: keyResults.goalId,
            goalTitle: goals.title,
            providerSpaceName: spaces.name,
            providerText: keyResultDependencies.providerText,
            escalatedAt: keyResultDependencies.escalatedAt,
          })
          .from(keyResultDependencies)
          .innerJoin(
            keyResults,
            eq(keyResults.id, keyResultDependencies.keyResultId),
          )
          .innerJoin(goals, eq(goals.id, keyResults.goalId))
          .leftJoin(
            spaces,
            eq(spaces.id, keyResultDependencies.providerSpaceId),
          )
          .where(
            and(
              activeOnly(
                keyResultDependencies,
                eq(keyResultDependencies.workspaceId, context.workspaceId),
                eq(keyResultDependencies.escalatedToId, memberId),
                eq(keyResultDependencies.confirmed, false),
                isNull(keyResultDependencies.riskOwnerId),
              ),
              isNull(keyResults.deletedAt),
              isNull(goals.deletedAt),
            ),
          )
          .orderBy(asc(keyResultDependencies.escalatedAt));

        for (const row of escalatedToMe) {
          if (
            !(await canSeeGoal(tx, context.workspaceId, memberId, row.goalId))
          ) {
            continue;
          }
          const provider =
            row.providerSpaceName ?? row.providerText ?? "another team";
          obligations.push({
            id: `dependency:${row.id}`,
            kind: "dependency",
            group: "today",
            title: `Decide the dependency of "${row.keyResultTitle}" on ${provider}`,
            meta: `Escalated to you as sponsor · ${row.goalTitle}`,
            dueLabel: `Escalated ${dueLocalDate(row.escalatedAt, timeZone) ?? "today"}`,
            dueOn: null,
            daysPastDue: null,
            href: "/cycle?phase=5",
            actionLabel: "Open the register",
            subjectId: row.goalId,
            checkInId: null,
            proposal: null,
          });
        }

        // Source 5: this week's commitments (P4-T08). A commitment is due at
        // the end of the week it was set in, which is what `week_start` plus
        // six days means; the session that closes it is what sets `closed_at`.
        const promised = await tx
          .select({
            id: commitments.id,
            text: commitments.text,
            weekStart: commitments.weekStart,
            spaceId: commitments.spaceId,
            spaceName: spaces.name,
            sessionId: commitments.sessionId,
          })
          .from(commitments)
          .innerJoin(spaces, eq(spaces.id, commitments.spaceId))
          .where(
            and(
              activeOnly(
                commitments,
                eq(commitments.workspaceId, context.workspaceId),
                eq(commitments.ownerId, memberId),
                isNull(commitments.closedAt),
              ),
            ),
          )
          .orderBy(asc(commitments.weekStart));

        for (const row of promised) {
          const dueOn = endOfWeek(row.weekStart);
          const days = daysPastDue(
            new Date(`${dueOn}T00:00:00Z`),
            now,
            timeZone,
          );
          if (days === null) {
            continue;
          }
          if (
            !(await canReach(
              tx,
              context.workspaceId,
              memberId,
              "space",
              row.spaceId,
            ))
          ) {
            continue;
          }
          obligations.push({
            id: `commitment:${row.id}`,
            kind: "commitment",
            group: groupFor(days),
            title: row.text,
            meta: `Committed · ${row.spaceName} · week of ${row.weekStart}`,
            dueLabel: dueLabelFor(days, dueOn),
            dueOn,
            daysPastDue: days,
            href: row.sessionId
              ? `/session/${row.sessionId}`
              : `/spaces/${row.spaceId}`,
            actionLabel: "Open the session",
            subjectId: row.spaceId,
            checkInId: null,
            proposal: null,
          });
        }

        // Source 6: the sessions this member is down to facilitate (P4-T04).
        // Scheduled only: a running session is already being run, and a closed
        // or skipped one is nobody's obligation.
        const toRun = await tx
          .select({
            id: okrSessions.id,
            kind: okrSessions.kind,
            title: okrSessions.title,
            scheduledFor: okrSessions.scheduledFor,
            spaceId: okrSessions.spaceId,
            spaceName: spaces.name,
          })
          .from(okrSessions)
          .innerJoin(spaces, eq(spaces.id, okrSessions.spaceId))
          .where(
            and(
              activeOnly(
                okrSessions,
                eq(okrSessions.workspaceId, context.workspaceId),
                eq(okrSessions.facilitatorId, memberId),
                eq(okrSessions.state, "scheduled"),
                isNotNull(okrSessions.scheduledFor),
              ),
            ),
          )
          .orderBy(asc(okrSessions.scheduledFor));

        for (const row of toRun) {
          const days = daysPastDue(row.scheduledFor, now, timeZone);
          // `space_id` is nullable on the table, and the inner join above
          // already excludes a session without one. The check is here so the
          // types agree with what the query guarantees.
          if (days === null || !row.spaceId) {
            continue;
          }
          if (
            !(await canReach(
              tx,
              context.workspaceId,
              memberId,
              "space",
              row.spaceId,
            ))
          ) {
            continue;
          }
          obligations.push({
            id: `session:${row.id}`,
            kind: "session",
            group: groupFor(days),
            title: `Run the ${row.kind} session${row.title ? `: ${row.title}` : ""}`,
            meta: `Facilitator · ${row.spaceName}`,
            dueLabel: dueLabelFor(
              days,
              dueLocalDate(row.scheduledFor, timeZone),
            ),
            dueOn: dueLocalDate(row.scheduledFor, timeZone),
            daysPastDue: days,
            href: `/session/${row.id}`,
            actionLabel: "Open the session",
            subjectId: row.spaceId,
            checkInId: null,
            proposal: null,
          });
        }

        // Source 7: agent proposals waiting on a decision (P2-T17, P4-T05).
        // "Propose by default" is a hard rule and a proposal nobody is told
        // about is the same as an agent that never spoke.
        //
        // **Who owes the decision is `mayDecideProposal`'s answer**, the same
        // function `proposals.apply` and `proposals.dismiss` ask, so a row
        // listed here is always one this member can decide (completeness
        // review M-08). A proposal a nudge carried is its recipient's; any
        // other is decided by edit on its subject. Before that, the row linked
        // to `/admin/agents` and the only apply path needed `full` on the
        // workspace: an ordinary champion was told they owed a decision and
        // could not make it.
        //
        // Copilot proposals are excluded. They belong to the thread that asked
        // for them and the panel that shows them, not to a shared queue.
        //
        // The subject's title comes back in the same query, so a row can say
        // which goal or KPI it is about without one read per row.
        const waiting = await tx
          .select({
            id: proposedChanges.id,
            action: proposedChanges.action,
            payload: proposedChanges.payload,
            aiGenerated: proposedChanges.aiGenerated,
            subjectType: proposedChanges.subjectType,
            subjectId: proposedChanges.subjectId,
            createdAt: proposedChanges.createdAt,
            goalTitle: goals.title,
            kpiTitle: kpis.title,
          })
          .from(proposedChanges)
          .leftJoin(
            goals,
            and(
              eq(proposedChanges.subjectType, "goal"),
              eq(goals.id, proposedChanges.subjectId),
              isNull(goals.deletedAt),
            ),
          )
          .leftJoin(
            kpis,
            and(
              eq(proposedChanges.subjectType, "kpi"),
              eq(kpis.id, proposedChanges.subjectId),
              isNull(kpis.deletedAt),
            ),
          )
          .where(
            // No `activeOnly` here: `proposed_changes` carries no
            // `deleted_at`. A proposal is applied or dismissed rather than
            // deleted, which is what `status` already says.
            and(
              eq(proposedChanges.workspaceId, context.workspaceId),
              eq(proposedChanges.status, "pending"),
              isNotNull(proposedChanges.runId),
            ),
          )
          .orderBy(asc(proposedChanges.createdAt));

        // Who each one was addressed to, asked once for all of them. Most
        // pending proposals in a busy workspace are other champions' drafted
        // check-ins, and each would otherwise cost this member a query to
        // learn that it is not theirs.
        const recipients = await proposalRecipients(
          tx,
          context.workspaceId,
          waiting.map((row) => row.id),
        );
        for (const row of waiting) {
          if (
            !(await mayDecideProposal(
              tx,
              context.workspaceId,
              memberId,
              row,
              recipients.get(row.id) ?? new Set(),
            ))
          ) {
            continue;
          }
          const age = daysPastDue(row.createdAt, now, timeZone) ?? 0;
          obligations.push({
            id: `proposal:${row.id}`,
            kind: "proposal",
            // A proposal has no due date. It is owed from the moment it exists,
            // which is what the acknowledgement grouping already expresses, so
            // the same escalation threshold decides when it stops being new.
            group: acknowledgementGroup(age, escalateAfter),
            title: proposalHeadline(
              row.action,
              row.goalTitle ?? row.kpiTitle ?? null,
            ),
            meta: `Agent proposal · ${publishedAgo(age)}`,
            dueLabel: acknowledgementDueLabel(age, escalateAfter),
            dueOn: dueLocalDate(row.createdAt, timeZone),
            daysPastDue: age,
            // The row itself, on the one screen every member can open. It is
            // decided there, so a link from anywhere else (a message, the
            // command line) lands on the decision rather than beside it.
            href: `/review#proposal-${row.id}`,
            actionLabel: "Review the proposal",
            subjectId: row.subjectId ?? context.workspaceId,
            checkInId: null,
            proposal: {
              id: row.id,
              action: row.action,
              aiGenerated: row.aiGenerated,
              preview: proposalPreview(row.payload as Record<string, unknown>),
            },
          });
        }

        const sorted = sortObligations(obligations);
        return {
          obligations: sorted,
          counts: countObligations(sorted),
          pending: PENDING_SOURCES.map((source) => ({ ...source })),
        };
      },
    );
  },
});
