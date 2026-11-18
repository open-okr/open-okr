/**
 * Copilot proposals: recorded, applied, dismissed, reversed (P4-T14b-a).
 *
 * Separate from `actions/copilot.ts` because it is a different guarantee. That
 * file is about a conversation nobody else may read. This one is about a write
 * the product is being asked to make, and the whole question is what stops it
 * from being made by the wrong person or without being seen.
 *
 * **Nothing here decides that the caller may do what the proposal asks.**
 * `copilot.applyProposal` calls the proposed action through `callAction` with the
 * applying member as the actor, so the action's own declared access level and its
 * own authorisation run exactly as they would if the member had typed it. A
 * member who may not create an objective gets the same refusal either way. That
 * is the point of the test-plan line "refused by the permission layer, not
 * hidden by the interface": the panel offers the button, and the layer says no.
 *
 * **A proposal is one member's, in their own conversation.** Every action here
 * refuses a proposal on somebody else's thread with not-found, the same as the
 * conversation actions.
 */
import {
  activeOnly,
  aiThreads,
  goals,
  proposedChanges,
  withContext,
} from "@openokr/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  captureReverse,
  changedSinceApplied,
  isEdit,
  reversalFor,
  settleReverse,
} from "../copilot/proposals.ts";
import { subjectPath } from "../notifications/links.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { policyDecisionInTx } from "../practice/policy.ts";
import { askingMemberId } from "./copilot.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";
import { callAction } from "./registry.ts";

/** The caller's own proposal on their own thread, or not-found. */
async function ownProposal(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  proposalId: string,
) {
  const [row] = await tx
    .select({
      id: proposedChanges.id,
      action: proposedChanges.action,
      payload: proposedChanges.payload,
      status: proposedChanges.status,
      result: proposedChanges.result,
      undoneAt: proposedChanges.undoneAt,
      reversePayload: proposedChanges.reversePayload,
      threadId: proposedChanges.threadId,
    })
    .from(proposedChanges)
    .innerJoin(aiThreads, eq(aiThreads.id, proposedChanges.threadId))
    .where(
      and(
        eq(proposedChanges.workspaceId, workspaceId),
        eq(proposedChanges.id, proposalId),
        // Not just any proposal: one from a copilot thread, and that thread has
        // to be this member's. An agent run's proposal goes through
        // `proposals.apply` for the member it is for (M-08), or
        // `proposals.bulkApply`, which requires `full`.
        isNotNull(proposedChanges.threadId),
        eq(aiThreads.memberId, memberId),
        // A deleted conversation takes its cards with it (plan 0.8.1 CP2):
        // soft delete is the default scope, and a card is reached through
        // the thread it was made in.
        isNull(aiThreads.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new OperationError("not_found", "No such proposal.");
  }
  return row;
}

/**
 * Where the thing an applied card made lives (plan 0.8.1 CP7, review F28).
 *
 * The card said Applied and nothing else, so the person had to go and find
 * the objective or task it had just made. Built from the action and what it
 * returned, through the one map of subject paths, so the card and the inbox
 * agree about where an objective is. A key result has no page of its own: it
 * is a row on its objective's page, anchored as `#kr-<id>`.
 */
function madeHref(
  action: string,
  payload: Readonly<Record<string, unknown>>,
  result: unknown,
): string | null {
  const id =
    typeof result === "object" && result !== null
      ? (result as { id?: unknown }).id
      : undefined;
  if (typeof id !== "string") {
    return null;
  }
  switch (action) {
    case "goals.create":
      return subjectPath("goal", id);
    case "goals.addKeyResult": {
      const goal = subjectPath(
        "goal",
        typeof payload.goalId === "string" ? payload.goalId : null,
      );
      return goal ? `${goal}#kr-${id}` : null;
    }
    case "initiatives.create":
      return subjectPath("initiative", id);
    case "tasks.create":
    case "tasks.move":
      return subjectPath("task", id);
    case "initiatives.update":
      return subjectPath("initiative", id);
    case "goals.update":
      return subjectPath("goal", id);
    case "goals.publishDraftedCheckIn":
      return subjectPath(
        "goal",
        typeof payload.goalId === "string" ? payload.goalId : null,
      );
    case "kpis.record":
      return subjectPath(
        "kpi",
        typeof payload.kpiId === "string" ? payload.kpiId : null,
      );
    default:
      return null;
  }
}

const previewSchema = z.array(
  z.object({ label: z.string(), value: z.string() }),
);

/**
 * Records a proposal against a conversation.
 *
 * `aiGenerated` is always true here, unlike an agent proposal: METHOD.md §6.5's
 * recovery draft is a template that works with the provider off, and a copilot
 * proposal only exists because a model wrote it.
 */
export const recordProposal = defineWriteAction({
  name: "copilot.recordProposal",
  agentSurface: false,
  summary: "Records a proposal the copilot made in a conversation.",
  input: z.object({
    threadId: z.uuid(),
    action: z.string().trim().min(1).max(120),
    payload: z.record(z.string(), z.unknown()),
    /** What the panel shows before anything is applied. */
    preview: previewSchema,
    /** The model's own sentence about why. */
    why: z.string().trim().min(1).max(1000),
    subjectType: z.string().trim().min(1).max(40).nullable(),
    subjectId: z.uuid().nullable(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    requires: ACCESS_LEVELS.comment,
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const [thread] = await tx
        .select({ id: aiThreads.id })
        .from(aiThreads)
        .where(
          activeOnly(
            aiThreads,
            eq(aiThreads.workspaceId, workspaceId),
            eq(aiThreads.id, input.threadId),
            eq(aiThreads.memberId, memberId),
          ),
        )
        .limit(1);
      if (!thread) {
        throw new OperationError("not_found", "No such conversation.");
      }

      const [row] = await tx
        .insert(proposedChanges)
        .values({
          workspaceId,
          runId: null,
          threadId: input.threadId,
          action: input.action,
          // The preview and the sentence travel with the payload rather than in
          // their own columns: they are how this one proposal reads, not
          // structure the product queries on.
          payload: {
            ...input.payload,
            __preview: input.preview,
            __why: input.why,
          },
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          aiGenerated: true,
        })
        .returning({ id: proposedChanges.id });
      if (!row) {
        throw new OperationError("not_found", "That did not save.");
      }

      return {
        result: { id: row.id },
        activity: {
          kind: "copilot.proposed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { threadId: input.threadId, action: input.action },
        },
        audit: {
          action: "copilot.recordProposal",
          targetType: "proposed_change",
          targetId: row.id,
          payload: { threadId: input.threadId, action: input.action },
        },
      };
    },
  }),
});

const proposalOutput = z.object({
  id: z.uuid(),
  action: z.string(),
  /** Label and value pairs, as they were built. */
  preview: previewSchema,
  why: z.string(),
  status: z.enum(["pending", "applied", "dismissed"]),
  /** True once applied and reversed. */
  undone: z.boolean(),
  /** False when this action has no reverse, so no undo is offered. */
  reversible: z.boolean(),
  /**
   * True when the workspace asks why anything is added mid-cycle (METHOD.md
   * §2.9), this proposal adds an objective or key result to a cycle that has
   * started, and it carries no reason. The card then asks for one (design
   * §4.3). Decided by the practice policy, never by a threshold copied here.
   */
  needsReason: z.boolean(),
  /**
   * When it was made, as an ISO time. A card is made for the question before
   * it, so this is what places it in its turn (plan 0.8.1 CP3).
   */
  createdAt: z.string(),
  /**
   * Where what it made lives, once applied and not undone (plan 0.8.1 CP7).
   * Null before then, after an undo, and for an action with no page.
   */
  href: z.string().nullable(),
});

/** What `proposed_changes.reverse_payload` holds, read back. */
const storedReverse = z.object({
  action: z.string(),
  payload: z.record(z.string(), z.unknown()),
  expect: z.record(z.string(), z.unknown()),
});

/** The two creates that may be refused for want of a reason. */
const REASON_ACTIONS = new Set(["goals.create", "goals.addKeyResult"]);

/**
 * Whether the practice would refuse this pending create for want of a reason.
 *
 * Asked of the policy itself with the reason left out, so the answer follows
 * the setting and the cycle's own dates and nothing is copied from
 * METHOD.md. The level and the reviewer are left out of the question on
 * purpose: another rule blocking first would hide this one from the card.
 */
async function needsReason(
  tx: OperationTx,
  workspaceId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!REASON_ACTIONS.has(action) || typeof payload.reason === "string") {
    return false;
  }
  let cycleId: string | null = null;
  if (action === "goals.create") {
    cycleId = typeof payload.cycleId === "string" ? payload.cycleId : null;
  } else if (typeof payload.goalId === "string") {
    const [goal] = await tx
      .select({ cycleId: goals.cycleId })
      .from(goals)
      .where(
        activeOnly(
          goals,
          eq(goals.workspaceId, workspaceId),
          eq(goals.id, payload.goalId),
        ),
      )
      .limit(1);
    cycleId = goal?.cycleId ?? null;
  }
  if (cycleId === null) {
    return false;
  }
  const decision = await policyDecisionInTx(
    tx,
    workspaceId,
    action === "goals.create"
      ? {
          kind: "objective.create",
          cycleId,
          hasReviewer: true,
          hasReason: false,
        }
      : { kind: "keyResult.create", cycleId, hasReason: false },
  );
  return (
    decision.outcome === "block" &&
    decision.rules.includes("reasons.midCycleAddition")
  );
}

/** The proposals in one of the reader's own conversations, newest first. */
export const readProposals = defineReadAction({
  name: "copilot.proposals",
  summary: "The proposals the copilot made in one conversation.",
  input: z.object({ threadId: z.uuid() }),
  output: z.array(proposalOutput),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const userId = context.actor.userId;
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId: userId ?? "" },
      async (rawTx) => {
        const tx = rawTx as unknown as OperationTx;
        const memberId = await askingMemberId(context);
        const [thread] = await tx
          .select({ id: aiThreads.id })
          .from(aiThreads)
          .where(
            activeOnly(
              aiThreads,
              eq(aiThreads.workspaceId, context.workspaceId),
              eq(aiThreads.id, input.threadId),
              eq(aiThreads.memberId, memberId),
            ),
          )
          .limit(1);
        if (!thread) {
          throw new OperationError("not_found", "No such conversation.");
        }

        const rows = await tx
          .select({
            id: proposedChanges.id,
            action: proposedChanges.action,
            payload: proposedChanges.payload,
            status: proposedChanges.status,
            result: proposedChanges.result,
            undoneAt: proposedChanges.undoneAt,
            reversePayload: proposedChanges.reversePayload,
            createdAt: proposedChanges.createdAt,
          })
          .from(proposedChanges)
          .where(
            and(
              eq(proposedChanges.workspaceId, context.workspaceId),
              eq(proposedChanges.threadId, input.threadId),
            ),
          )
          .orderBy(desc(proposedChanges.createdAt), desc(proposedChanges.id));

        const proposals = [];
        for (const row of rows) {
          const payload = row.payload as Record<string, unknown>;
          proposals.push({
            id: row.id,
            action: row.action,
            preview: previewSchema.catch([]).parse(payload.__preview),
            why: typeof payload.__why === "string" ? payload.__why : "",
            status: row.status,
            undone: row.undoneAt !== null,
            // Whether an undo is possible at all, answered from the catalogue
            // rather than from hope. Before it is applied there is no result to
            // reverse, so the answer is about the action, not this row.
            // An edit has no result to reverse from: it can be undone from
            // the moment it is proposed, and once applied only if the values
            // from before were kept.
            reversible: isEdit(row.action)
              ? row.status === "applied"
                ? row.reversePayload !== null
                : true
              : reversalFor(row.action, row.result ?? { id: "probe" }) !== null,
            needsReason:
              row.status === "pending" &&
              (await needsReason(tx, context.workspaceId, row.action, payload)),
            createdAt: row.createdAt.toISOString(),
            href:
              row.status === "applied" && row.undoneAt === null
                ? madeHref(row.action, payload, row.result)
                : null,
          });
        }
        return proposals;
      },
    );
  },
});

/** Everything but the payload the action itself takes. */
const withoutPreview = (payload: Record<string, unknown>) => {
  const { __preview, __why, ...rest } = payload;
  void __preview;
  void __why;
  return rest;
};

/**
 * Applies one proposal, as the member.
 *
 * The proposed action runs in its own Operation, outside this one's transaction,
 * for the reason `proposals.bulkApply` records: it is an independent domain write
 * with its own audit and outbox rows, and folding it in would roll back the
 * decision when the write fails. Here it also means the action's own refusal
 * reaches the caller as a refusal rather than as a rolled-back transaction.
 */
export const applyProposal = defineWriteAction({
  name: "copilot.applyProposal",
  summary:
    "Applies one copilot proposal through the normal Operation pipeline.",
  input: z.object({
    id: z.uuid(),
    /**
     * The person's own words for why an objective or key result starts
     * mid-cycle, typed on the card when the workspace asks for one (design
     * §4.3). Merged into the payload of those two creates only.
     */
    reason: z.string().trim().min(1).max(500).optional(),
  }),
  output: z.object({
    id: z.uuid(),
    /** What the applied action returned, for the undo and for the link. */
    result: z.record(z.string(), z.unknown()).nullable(),
  }),
  access: ACCESS_LEVELS.comment,
  operation: (context, input) => ({
    requires: ACCESS_LEVELS.comment,
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const proposal = await ownProposal(tx, workspaceId, memberId, input.id);
      if (proposal.status !== "pending") {
        throw new OperationError(
          "forbidden",
          "That proposal has already been decided.",
        );
      }

      // The person's typed reason joins the payload of the two creates that
      // take one, and nothing else: it is theirs, so it replaces a model's.
      const storedPayload = proposal.payload as Record<string, unknown>;
      const merged =
        input.reason !== undefined && REASON_ACTIONS.has(proposal.action)
          ? { ...storedPayload, reason: input.reason }
          : storedPayload;
      const callContext = {
        pool: context.pool,
        workspaceId,
        actor: {
          kind: actor.kind,
          userId: context.actor.userId,
          memberId,
        },
        proposalId: input.id,
      };
      const actionPayload = withoutPreview(merged);

      // An edit returns only an id, so the values from before are read now,
      // as the member, just before the action's own transaction (design §4.2).
      const captured = await captureReverse(
        callContext,
        proposal.action,
        actionPayload,
      );

      // As the member, with their own access. An action they may not perform is
      // refused here by its own authorisation, and the refusal is the answer.
      const result = (await callAction(
        callContext,
        proposal.action as never,
        actionPayload as never,
      )) as Record<string, unknown>;

      // A reverse that needs what the action created, a new check-in's id or a
      // new KPI value's id, is completed now that it exists.
      const reverse =
        captured === null
          ? null
          : settleReverse(proposal.action, captured, result);

      await tx
        .update(proposedChanges)
        .set({
          status: "applied",
          decidedByMemberId: memberId,
          decidedAt: new Date(),
          result,
          ...(reverse === null ? {} : { reversePayload: reverse }),
          ...(merged === storedPayload ? {} : { payload: merged }),
        })
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.id, input.id),
          ),
        );

      return {
        result: { id: input.id, result },
        activity: {
          kind: "copilot.proposalApplied",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { action: proposal.action },
        },
        audit: {
          action: "copilot.applyProposal",
          targetType: "proposed_change",
          targetId: input.id,
          payload: { proposedAction: proposal.action, result },
        },
      };
    },
  }),
});

/** Dismisses one proposal without applying it. */
export const dismissProposal = defineWriteAction({
  name: "copilot.dismissProposal",
  summary: "Dismisses one copilot proposal without applying it.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.comment,
  operation: (_context, input) => ({
    requires: ACCESS_LEVELS.comment,
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const proposal = await ownProposal(tx, workspaceId, memberId, input.id);
      if (proposal.status !== "pending") {
        throw new OperationError(
          "forbidden",
          "That proposal has already been decided.",
        );
      }

      await tx
        .update(proposedChanges)
        .set({
          status: "dismissed",
          decidedByMemberId: memberId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.id, input.id),
          ),
        );

      return {
        result: { id: input.id },
        activity: {
          kind: "copilot.proposalDismissed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { action: proposal.action },
        },
        audit: {
          action: "copilot.dismissProposal",
          targetType: "proposed_change",
          targetId: input.id,
          payload: { proposedAction: proposal.action },
        },
      };
    },
  }),
});

/**
 * Reverses an applied proposal.
 *
 * **Undo is a real write, not a rollback.** The reverse action runs through the
 * pipeline as the member, with its own audit row, so the record says a thing was
 * created and then removed. Pretending it never happened would be the one thing
 * an audit trail is for.
 *
 * Only where the catalogue declares a reverse. `goals.create` reverses to
 * `goals.delete`, which is `full`: a member at `edit` can apply a proposal that
 * creates an objective and cannot undo it. That is the access model answering
 * honestly rather than the copilot inventing a right.
 */
export const undoProposal = defineWriteAction({
  name: "copilot.undoProposal",
  summary:
    "Reverses an applied copilot proposal, where the action has a reverse.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.comment,
  operation: (context, input) => ({
    requires: ACCESS_LEVELS.comment,
    async execute({ tx, workspaceId, actor }) {
      const memberId = actor.memberId;
      if (!memberId) {
        throw new OperationError("not_found", "No such workspace.");
      }
      const proposal = await ownProposal(tx, workspaceId, memberId, input.id);
      if (proposal.status !== "applied") {
        throw new OperationError(
          "forbidden",
          "Only an applied proposal can be undone.",
        );
      }
      if (proposal.undoneAt !== null) {
        throw new OperationError("forbidden", "That was already undone.");
      }

      // An edit keeps its own reverse, read before it was applied. A create
      // reverses from what it returned.
      const kept = storedReverse.safeParse(proposal.reversePayload);
      const callContext = {
        pool: context.pool,
        workspaceId,
        actor: {
          kind: actor.kind,
          userId: context.actor.userId,
          memberId,
        },
      };
      if (kept.success) {
        const stale = await changedSinceApplied(
          callContext,
          proposal.action,
          withoutPreview(proposal.payload as Record<string, unknown>),
          kept.data.expect,
        );
        if (stale) {
          throw new OperationError(
            "forbidden",
            "This changed after it was applied, so undoing it would overwrite the later change.",
          );
        }
      }
      const reversal = kept.success
        ? { action: kept.data.action, payload: kept.data.payload }
        : isEdit(proposal.action)
          ? null
          : reversalFor(
              proposal.action,
              (proposal.result ?? null) as Record<string, unknown> | null,
            );
      if (!reversal) {
        throw new OperationError(
          "forbidden",
          "This proposal cannot be undone: the action it applied has no reverse.",
        );
      }

      await callAction(
        callContext,
        reversal.action as never,
        reversal.payload as never,
      );

      await tx
        .update(proposedChanges)
        .set({ undoneAt: new Date() })
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.id, input.id),
          ),
        );

      return {
        result: { id: input.id },
        activity: {
          kind: "copilot.proposalUndone",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { action: proposal.action },
        },
        audit: {
          action: "copilot.undoProposal",
          targetType: "proposed_change",
          targetId: input.id,
          payload: {
            proposedAction: proposal.action,
            reversedWith: reversal.action,
          },
        },
      };
    },
  }),
});
