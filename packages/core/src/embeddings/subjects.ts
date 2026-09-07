/**
 * What is worth embedding, and how to read its current text (AI-NATIVE-PLAN.md
 * §9, P4-T13a).
 *
 * **The enqueue lives in the Operation pipeline and the opt-in lives on the
 * activity row**, which is the shape `ActivityInput.notify` already set: fan-out
 * is opt-in per write and handled centrally, because most activities have no
 * subscriber and most writes change no embeddable text. Agung chose the central
 * mechanism on 26 August 2026.
 *
 * Two ways a write opts in:
 *
 * - It sets nothing, and the pipeline enqueues because the activity's own
 *   subject is embeddable. This covers goals, key results, check-ins, blockers
 *   and anything else whose activity points at the content that changed.
 * - It sets `activity.embed` explicitly, naming the content. This is for writes
 *   whose activity points at a container rather than at what changed: a retro
 *   note's activity names the space, a narrative's names the goal, and embedding
 *   the container would be embedding the wrong thing.
 *
 * **A cycle is not in either list.** It is a period with a name and no prose, so
 * embedding "Q1 2026" would put a retrieval hit in the index that answers
 * nothing. The plan's "cycle artifacts" is the learnings and the next-cycle
 * drafts, which are here.
 *
 * **Nothing here decides whether the text changed.** The worker re-reads the
 * content and hashes it, and `EmbeddingService.index()` skips a chunk whose hash
 * is unchanged. That is what makes a duplicate enqueue cheap and what the
 * acceptance criterion tests: a goal edited twice with the same text embeds once.
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
  retroNotes,
  reviewNarratives,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import type { OperationTx } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";

/** The outbox topic. One topic, because one worker drains it. */
export const EMBED_TOPIC = "content.embed";

/**
 * Subject types the pipeline enqueues without being asked.
 *
 * Only the ones whose activity subject *is* the content. A session's activities
 * name the space it happened in, so a session is not in this list and its
 * contents opt in explicitly instead.
 */
const EMBEDDABLE_SUBJECTS = [
  "goal",
  "key_result",
  "check_in",
  "blocker",
  // A comment's activity already names the comment rather than what it hangs
  // off, so it is automatic like the rest of this list.
  "comment",
] as const;

export type EmbeddableSubject = (typeof EMBEDDABLE_SUBJECTS)[number];

export function isEmbeddableSubject(
  subjectType: string,
): subjectType is EmbeddableSubject {
  return (EMBEDDABLE_SUBJECTS as readonly string[]).includes(subjectType);
}

/**
 * Every entity type the worker knows how to read.
 *
 * The pipeline's automatic set plus the ones that opt in explicitly. A payload
 * naming anything else is dropped by the worker with a reason rather than
 * throwing: an outbox row for a type this build cannot read is a row that would
 * otherwise retry until it dead-letters.
 */
const EMBEDDABLE_TYPES = [
  ...EMBEDDABLE_SUBJECTS,
  "review_narrative",
  "retro_note",
  "kudos",
  "learning",
  "next_cycle_draft",
] as const;

export type EmbeddableType = (typeof EMBEDDABLE_TYPES)[number];

export function isEmbeddableType(value: string): value is EmbeddableType {
  return (EMBEDDABLE_TYPES as readonly string[]).includes(value);
}

/** Joins the parts of one entity's text, dropping the empty ones. */
const join = (...parts: readonly (string | null | undefined)[]) =>
  parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n");

/**
 * The entity's embeddable text as it stands now, or null when there is none.
 *
 * Read at worker time rather than carried on the outbox row, and that is
 * deliberate: a row written three edits ago would embed text the product no
 * longer holds. The row names what changed; the worker asks what it says.
 *
 * Rich text goes through `excerptRichText`, the one shared module, so an embedded
 * chunk is the same plain text every other surface derives from editor JSON.
 */
export async function embeddableTextInTx(
  tx: OperationTx,
  workspaceId: string,
  entityType: EmbeddableType,
  entityId: string,
): Promise<string | null> {
  const one = <T>(rows: readonly T[]) => rows[0] ?? null;

  switch (entityType) {
    case "goal": {
      const row = one(
        await tx
          .select({ title: goals.title, description: goals.description })
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
      if (!row) {
        return null;
      }
      return (
        join(
          row.title,
          row.description === null
            ? null
            : excerptRichText(row.description as never, 8000),
        ) || null
      );
    }
    case "key_result": {
      const row = one(
        await tx
          .select({ title: keyResults.title })
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
      return row?.title.trim() || null;
    }
    case "comment": {
      const row = one(
        await tx
          .select({ body: comments.body })
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
      if (!row) {
        return null;
      }
      return excerptRichText(row.body as never, 8000) || null;
    }
    case "check_in": {
      const row = one(
        await tx
          .select({ narrative: checkIns.narrative })
          .from(checkIns)
          .where(
            activeOnly(
              checkIns,
              eq(checkIns.workspaceId, workspaceId),
              eq(checkIns.id, entityId),
              // A draft is visible only to its author (P3-T07), so embedding one
              // would put unpublished text into a shared index.
              eq(checkIns.state, "published"),
            ),
          )
          .limit(1),
      );
      if (!row || row.narrative === null) {
        return null;
      }
      return excerptRichText(row.narrative as never, 8000) || null;
    }
    case "blocker": {
      const row = one(
        await tx
          .select({
            description: blockers.description,
            nextAction: blockers.nextAction,
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
      return join(row.description, row.nextAction) || null;
    }
    case "review_narrative": {
      const row = one(
        await tx
          .select({ body: reviewNarratives.body })
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
      if (!row || row.body === null) {
        return null;
      }
      return excerptRichText(row.body as never, 8000) || null;
    }
    case "retro_note": {
      const row = one(
        await tx
          .select({ text: retroNotes.text })
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
      return row?.text.trim() || null;
    }
    case "learning": {
      const row = one(
        await tx
          .select({ text: learnings.text })
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
      return row?.text.trim() || null;
    }
    case "next_cycle_draft": {
      const row = one(
        await tx
          .select({
            title: nextCycleDrafts.title,
            why: nextCycleDrafts.why,
          })
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
      if (!row) {
        return null;
      }
      return join(row.title, row.why) || null;
    }
    case "kudos": {
      const row = one(
        await tx
          .select({ text: kudos.text })
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
      return row?.text.trim() || null;
    }
    default: {
      // Exhaustive over `EmbeddableType`, so adding a type without teaching this
      // function to read it fails the build rather than silently embedding
      // nothing.
      const never: never = entityType;
      return never;
    }
  }
}
