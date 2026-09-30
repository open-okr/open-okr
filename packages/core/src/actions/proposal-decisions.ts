/**
 * Deciding one agent proposal from the review inbox (completeness review M-08).
 *
 * `proposals.bulkApply` and `proposals.bulkDismiss` are the administrator's
 * queue on `/admin/agents`, and they need `full` on the workspace. These two
 * are the member's: one proposal at a time, for whoever the review inbox listed
 * it for. `mayDecideProposal` is the rule for both, so the inbox cannot offer a
 * decision these refuse, or the other way round.
 *
 * **Deciding grants nothing.** Applying runs the proposed action as the member,
 * through `callAction`, so that action's declared level and its own checks run
 * exactly as if the member had typed it. A member who may decide a proposal and
 * may not perform what it asks gets that action's refusal, and the proposal
 * stays pending.
 *
 * **Not-found rather than forbidden** for a proposal the member may not decide,
 * the same answer the access getter gives for anything a member may not touch.
 * A copilot proposal is not-found here too: it belongs to its conversation, and
 * `copilot.applyProposal` is its path.
 *
 * **Only a person decides.** An agent that could apply a proposal would be
 * approving its own work, and propose-and-approve would be a queue it clears by
 * itself. Direct writes are the per-agent `autonomy` setting's to grant, not
 * something an agent reaches by calling this.
 */
import { proposedChanges } from "@openokr/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  OperationError,
  type OperationTx,
  type ResolvedActor,
} from "../operations/operation.ts";
import { mayDecideProposal } from "../review/proposals.ts";
import { defineWriteAction } from "./define.ts";
import { callAction } from "./registry.ts";

/**
 * The pending agent proposal this member may decide, locked until the decision
 * commits.
 *
 * The lock is what makes a double click one decision. The proposed action runs
 * outside this transaction, so without it two applies arriving together would
 * both run it; with it, the second waits here, then reads `applied` and stops.
 * `no key update` rather than `update`, because the decision changes no key: a
 * write elsewhere that only references this row, such as a nudge naming it,
 * takes a key-share lock, and this one leaves that free.
 *
 * Access is asked before status, so a member who may not decide a proposal
 * cannot learn whether it has been decided either.
 */
async function decidable(
  tx: OperationTx,
  workspaceId: string,
  actor: ResolvedActor,
  id: string,
) {
  if (actor.kind !== "human") {
    throw new OperationError(
      "forbidden",
      "Only a person can decide an agent's proposal.",
    );
  }
  const memberId = actor.memberId;
  const [row] = await tx
    .select({
      id: proposedChanges.id,
      action: proposedChanges.action,
      payload: proposedChanges.payload,
      subjectType: proposedChanges.subjectType,
      subjectId: proposedChanges.subjectId,
      status: proposedChanges.status,
    })
    .from(proposedChanges)
    .where(
      and(
        eq(proposedChanges.workspaceId, workspaceId),
        eq(proposedChanges.id, id),
        isNotNull(proposedChanges.runId),
      ),
    )
    .limit(1)
    .for("no key update");
  if (
    !row ||
    !memberId ||
    !(await mayDecideProposal(tx, workspaceId, memberId, row))
  ) {
    throw new OperationError("not_found", "No such proposal.");
  }
  if (row.status !== "pending") {
    throw new OperationError(
      "forbidden",
      "That proposal has already been decided.",
    );
  }
  return row;
}

export const applyAgentProposal = defineWriteAction({
  name: "proposals.apply",
  summary:
    "Applies one agent proposal the caller may decide, running the proposed action as them.",
  input: z.object({ id: z.uuid() }),
  output: z.object({
    id: z.uuid(),
    /** What the applied action returned. */
    result: z.record(z.string(), z.unknown()).nullable(),
  }),
  // `edit`, the floor for every write that is not a member's own (the
  // registry test holds it). The real gate is the proposal's subject, checked
  // in `load`, and then the proposed action's own level.
  access: ACCESS_LEVELS.edit,
  operation: (context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return decidable(tx, workspaceId, actor, input.id);
    },
    async execute({ tx, workspaceId, actor, loaded }) {
      // A proposal that decides proposals would be an agent clearing its own
      // queue through a person's click. It would also wait forever on the row
      // lock `load` holds, because the decision it names runs on a second
      // connection. It can still be dismissed.
      if (loaded.action.startsWith("proposals.")) {
        throw new OperationError(
          "forbidden",
          "A proposal cannot decide another proposal. Dismiss it instead.",
        );
      }

      // Outside this transaction, for the reason `proposals.bulkApply`
      // records: the proposed action is an independent write with its own
      // audit and outbox rows. Its refusal throws here, this transaction rolls
      // back, and the proposal stays pending with the refusal as the answer.
      const result = (await callAction(
        {
          pool: context.pool,
          workspaceId,
          actor: {
            kind: actor.kind,
            userId: context.actor.userId,
            memberId: actor.memberId ?? undefined,
          },
        },
        loaded.action as never,
        loaded.payload as never,
      )) as Record<string, unknown> | null;

      // openokr:allow-mutation: the operation's own execute, on the
      // transaction runOperation opened. Only the decision fields change; the
      // proposal's effect committed in its own transaction above.
      await tx
        .update(proposedChanges)
        .set({
          status: "applied",
          decidedByMemberId: actor.memberId,
          decidedAt: new Date(),
          result: result ?? null,
        })
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.id, loaded.id),
          ),
        );

      return {
        result: { id: loaded.id, result: result ?? null },
        activity: {
          kind: "proposed_change.applied",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { action: loaded.action },
        },
        audit: {
          action: "proposals.apply",
          targetType: "proposed_change",
          targetId: loaded.id,
          payload: { proposedAction: loaded.action },
        },
      };
    },
  }),
});

export const dismissAgentProposal = defineWriteAction({
  name: "proposals.dismiss",
  summary:
    "Dismisses one agent proposal the caller may decide, without applying it.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async load({ tx, workspaceId, actor }) {
      return decidable(tx, workspaceId, actor, input.id);
    },
    async execute({ tx, workspaceId, actor, loaded }) {
      // openokr:allow-mutation: the operation's own execute.
      await tx
        .update(proposedChanges)
        .set({
          status: "dismissed",
          decidedByMemberId: actor.memberId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(proposedChanges.workspaceId, workspaceId),
            eq(proposedChanges.id, loaded.id),
          ),
        );

      return {
        result: { id: loaded.id },
        activity: {
          kind: "proposed_change.dismissed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { action: loaded.action },
        },
        audit: {
          action: "proposals.dismiss",
          targetType: "proposed_change",
          targetId: loaded.id,
          payload: { proposedAction: loaded.action },
        },
      };
    },
  }),
});
