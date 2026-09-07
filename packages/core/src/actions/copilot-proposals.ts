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
  proposedChanges,
  withContext,
} from "@openokr/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { reversalFor } from "../copilot/proposals.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
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
        // `proposals.bulkApply`, which requires `full`.
        isNotNull(proposedChanges.threadId),
        eq(aiThreads.memberId, memberId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new OperationError("not_found", "No such proposal.");
  }
  return row;
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
});

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
          })
          .from(proposedChanges)
          .where(
            and(
              eq(proposedChanges.workspaceId, context.workspaceId),
              eq(proposedChanges.threadId, input.threadId),
            ),
          )
          .orderBy(desc(proposedChanges.createdAt), desc(proposedChanges.id));

        return rows.map((row) => {
          const payload = row.payload as Record<string, unknown>;
          return {
            id: row.id,
            action: row.action,
            preview: previewSchema.catch([]).parse(payload.__preview),
            why: typeof payload.__why === "string" ? payload.__why : "",
            status: row.status,
            undone: row.undoneAt !== null,
            // Whether an undo is possible at all, answered from the catalogue
            // rather than from hope. Before it is applied there is no result to
            // reverse, so the answer is about the action, not this row.
            reversible:
              reversalFor(row.action, row.result ?? { id: "probe" }) !== null,
          };
        });
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
  input: z.object({ id: z.uuid() }),
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

      // As the member, with their own access. An action they may not perform is
      // refused here by its own authorisation, and the refusal is the answer.
      const result = (await callAction(
        {
          pool: context.pool,
          workspaceId,
          actor: {
            kind: actor.kind,
            userId: context.actor.userId,
            memberId,
          },
        },
        proposal.action as never,
        withoutPreview(proposal.payload as Record<string, unknown>) as never,
      )) as Record<string, unknown>;

      await tx
        .update(proposedChanges)
        .set({
          status: "applied",
          decidedByMemberId: memberId,
          decidedAt: new Date(),
          result,
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

      const reversal = reversalFor(
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
        {
          pool: context.pool,
          workspaceId,
          actor: {
            kind: actor.kind,
            userId: context.actor.userId,
            memberId,
          },
        },
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
