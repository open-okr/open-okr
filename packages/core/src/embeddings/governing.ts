/**
 * Which access-scoped resource governs an embedded chunk (AI-NATIVE-PLAN.md §9,
 * P4-T13b).
 *
 * **Retrieval is filtered by asking the same getter every other read asks.** The
 * access getter resolves five subject types: workspace, blob, space, goal and
 * comment. A key result is deliberately absent because it inherits its goal's
 * context, and its callers resolve the owning goal first so that "no such key
 * result" and "not yours to see" answer identically. Every embeddable type here
 * maps onto one of those five for the same reason.
 *
 * **No second answer about who can see what.** The alternative was a `context_id`
 * column on `embeddings` and a SQL filter, which would be faster and would be a
 * second implementation of the access model. This asks `getAccessScoped`, which
 * means retrieval cannot drift from the rest of the product: if a member loses
 * access to a space, the chunks written in its review stop coming back on the
 * next query with no reindex and no backfill.
 *
 * The cost is one resolution per candidate hit. That is recorded on the P4-T13b
 * row as the thing to measure if retrieval ever feels slow, with the `context_id`
 * column as the known faster shape.
 */
import {
  activeOnly,
  blockers,
  checkIns,
  comments,
  goals,
  keyResults,
  kudos,
  learnings,
  nextCycleDrafts,
  okrSessions,
  retroNotes,
  reviewNarratives,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import type { OperationTx } from "../operations/operation.ts";

interface GoverningResource {
  readonly resourceType: string;
  readonly resourceId: string;
}

/** The session's space, or the workspace when the review has no space. */
async function throughSession(
  tx: OperationTx,
  workspaceId: string,
  sessionId: string,
): Promise<GoverningResource> {
  const [session] = await tx
    .select({ spaceId: okrSessions.spaceId })
    .from(okrSessions)
    .where(
      activeOnly(
        okrSessions,
        eq(okrSessions.workspaceId, workspaceId),
        eq(okrSessions.id, sessionId),
      ),
    )
    .limit(1);
  return session?.spaceId
    ? { resourceType: "space", resourceId: session.spaceId }
    : { resourceType: "workspace", resourceId: workspaceId };
}

/**
 * The resource whose access decides whether this chunk may be read, or null when
 * the entity is gone.
 *
 * Private. `mayRead` below is the only caller and the only thing anyone wants:
 * the resource on its own is an intermediate answer, and exporting it invited a
 * second copy of the resolve-then-ask pair (P4-T14a-a).
 *
 * A null answer withholds the chunk. An entity that has been deleted since it was
 * embedded has no access to inherit, and returning the chunk anyway would make
 * the index outlive the thing it describes.
 */
async function governingResource(
  tx: OperationTx,
  workspaceId: string,
  entityType: string,
  entityId: string,
): Promise<GoverningResource | null> {
  const one = <T>(rows: readonly T[]) => rows[0] ?? null;

  switch (entityType) {
    // **Read even though the id is the answer.** Returning the id unchecked let
    // a soft-deleted goal's chunk through: its access context row survives the
    // delete, so `getAccessScoped` still said yes. Every other case here reads
    // its row and `activeOnly` does this work; these two skipped it and a test
    // caught them.
    case "goal": {
      const row = one(
        await tx
          .select({ id: goals.id })
          .from(goals)
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, workspaceId),
              eq(goals.id, entityId),
            ),
          )
          .limit(1),
      );
      return row ? { resourceType: "goal", resourceId: entityId } : null;
    }

    case "comment": {
      const row = one(
        await tx
          .select({ id: comments.id })
          .from(comments)
          .where(
            activeOnly(
              comments,
              eq(comments.workspaceId, workspaceId),
              eq(comments.id, entityId),
            ),
          )
          .limit(1),
      );
      // The comment resolves its own parent inside the access getter, so it goes
      // through as itself once it is known to still exist.
      return row ? { resourceType: "comment", resourceId: entityId } : null;
    }

    case "key_result": {
      const row = one(
        await tx
          .select({ goalId: keyResults.goalId })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, workspaceId),
              eq(keyResults.id, entityId),
            ),
          )
          .limit(1),
      );
      return row ? { resourceType: "goal", resourceId: row.goalId } : null;
    }

    case "check_in": {
      const row = one(
        await tx
          .select({
            subjectType: checkIns.subjectType,
            subjectId: checkIns.subjectId,
          })
          .from(checkIns)
          .where(
            activeOnly(
              checkIns,
              eq(checkIns.workspaceId, workspaceId),
              eq(checkIns.id, entityId),
            ),
          )
          .limit(1),
      );
      // §6.2 attaches a check-in to a goal. If that ever widens, an unknown
      // subject type withholds the chunk rather than guessing.
      return row && row.subjectType === "goal"
        ? { resourceType: "goal", resourceId: row.subjectId }
        : null;
    }

    case "blocker": {
      const row = one(
        await tx
          .select({
            goalId: blockers.goalId,
            keyResultId: blockers.keyResultId,
          })
          .from(blockers)
          .where(
            activeOnly(
              blockers,
              eq(blockers.workspaceId, workspaceId),
              eq(blockers.id, entityId),
            ),
          )
          .limit(1),
      );
      if (!row) {
        return null;
      }
      if (row.goalId) {
        return { resourceType: "goal", resourceId: row.goalId };
      }
      if (!row.keyResultId) {
        return null;
      }
      const parent = one(
        await tx
          .select({ goalId: keyResults.goalId })
          .from(keyResults)
          .where(
            activeOnly(
              keyResults,
              eq(keyResults.workspaceId, workspaceId),
              eq(keyResults.id, row.keyResultId),
            ),
          )
          .limit(1),
      );
      return parent
        ? { resourceType: "goal", resourceId: parent.goalId }
        : null;
    }

    case "review_narrative": {
      const row = one(
        await tx
          .select({ goalId: reviewNarratives.goalId })
          .from(reviewNarratives)
          .where(
            activeOnly(
              reviewNarratives,
              eq(reviewNarratives.workspaceId, workspaceId),
              eq(reviewNarratives.id, entityId),
            ),
          )
          .limit(1),
      );
      return row ? { resourceType: "goal", resourceId: row.goalId } : null;
    }

    case "retro_note": {
      const row = one(
        await tx
          .select({ sessionId: retroNotes.sessionId })
          .from(retroNotes)
          .where(
            activeOnly(
              retroNotes,
              eq(retroNotes.workspaceId, workspaceId),
              eq(retroNotes.id, entityId),
            ),
          )
          .limit(1),
      );
      return row ? throughSession(tx, workspaceId, row.sessionId) : null;
    }

    case "kudos": {
      const row = one(
        await tx
          .select({ sessionId: kudos.sessionId })
          .from(kudos)
          .where(
            activeOnly(
              kudos,
              eq(kudos.workspaceId, workspaceId),
              eq(kudos.id, entityId),
            ),
          )
          .limit(1),
      );
      return row ? throughSession(tx, workspaceId, row.sessionId) : null;
    }

    case "learning": {
      const row = one(
        await tx
          .select({ sessionId: learnings.sessionId })
          .from(learnings)
          .where(
            activeOnly(
              learnings,
              eq(learnings.workspaceId, workspaceId),
              eq(learnings.id, entityId),
            ),
          )
          .limit(1),
      );
      if (!row) {
        return null;
      }
      // A learning captured outside a review has no session. It belongs to the
      // cycle, which nothing narrower than the workspace governs.
      return row.sessionId
        ? throughSession(tx, workspaceId, row.sessionId)
        : { resourceType: "workspace", resourceId: workspaceId };
    }

    case "next_cycle_draft": {
      const row = one(
        await tx
          .select({ sessionId: nextCycleDrafts.sessionId })
          .from(nextCycleDrafts)
          .where(
            activeOnly(
              nextCycleDrafts,
              eq(nextCycleDrafts.workspaceId, workspaceId),
              eq(nextCycleDrafts.id, entityId),
            ),
          )
          .limit(1),
      );
      return row ? throughSession(tx, workspaceId, row.sessionId) : null;
    }

    default:
      // **Withheld, not allowed.** A type nobody has mapped is a type whose
      // access nobody has decided, and the safe answer to "may this be read" is
      // no. Failing closed is the whole reason this function returns a resource
      // rather than a boolean.
      return null;
  }
}

/**
 * Whether this member may read this embedded entity, right now (P4-T14a-a).
 *
 * Resolves the governing resource and asks the access getter, which is the one
 * answer this product has about who can see what. Two callers need it:
 * retrieval, filtering candidates before they are ranked, and the copilot,
 * filtering a stored citation at the moment somebody reads the thread. They ask
 * the same question, so they call the same function; a second copy of this loop
 * is how a citation and a retrieval hit would come to disagree.
 *
 * False for an entity that has been deleted, for one whose type nobody has
 * mapped, and for a member the getter refuses. The getter answers not-found for
 * forbidden, and both mean the same thing here: not there for this reader.
 */
export async function mayRead(
  tx: OperationTx,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly entityType: string;
    readonly entityId: string;
  },
): Promise<boolean> {
  const governing = await governingResource(
    tx,
    input.workspaceId,
    input.entityType,
    input.entityId,
  );
  if (!governing) {
    return false;
  }
  try {
    await getAccessScoped(tx, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      resourceType: governing.resourceType,
      resourceId: governing.resourceId,
      requires: ACCESS_LEVELS.view as never,
    });
    return true;
  } catch {
    return false;
  }
}
