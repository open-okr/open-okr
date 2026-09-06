/**
 * What is worth indexing, and how to read its current text (TECHNICAL-PLAN §5,
 * §9, P5-T13).
 *
 * **The same shape `embeddings/subjects.ts` set, deliberately.** The pipeline
 * enqueues one outbox row per write for each index, from the same place and on
 * the same trigger, so the two cannot come to disagree about what exists. The
 * sets differ because the questions differ: retrieval wants prose an answer can
 * be grounded in, and search wants anything somebody might type the name of. A
 * KPI, an initiative, a task and a session are searchable and hold no prose
 * worth embedding.
 *
 * **Every row carries the context that decides who may see it.** That is the
 * difference from retrieval, which asks the access getter once per candidate:
 * with the context on the row, a search filters in SQL through the same
 * `EXISTS` clause every list read composes, and a member who loses a space
 * stops seeing its rows on the next query with no reindex. The work-layer
 * design's §5.2 records it as the better shape; this is where it lands.
 *
 * **A row with no context is invisible to everybody.** When an entity's context
 * cannot be resolved (it was deleted between the write and the worker), the
 * projection is removed rather than written contextless. A row nobody can find
 * is the safe direction for a mistake to fall, and no row at all is safer still.
 */
import {
  activeOnly,
  checkIns,
  comments,
  documents,
  goals,
  initiatives,
  keyResults,
  kpis,
  okrSessions,
  tasks,
} from "@openokr/db";
import { eq } from "drizzle-orm";
import { resolveSubjectContext } from "../access/reads.ts";
import type { OperationTx } from "../operations/operation.ts";
import { excerptRichText } from "../rich-text/excerpt.ts";

/** The outbox topic. One topic, because one worker drains it. */
export const INDEX_TOPIC = "content.index";

/**
 * Subject types the pipeline enqueues without being asked.
 *
 * Only the ones whose activity subject *is* the thing somebody would search
 * for. A session's activities name the space it happened in, so a session is
 * not here and is indexed by the write that names it.
 */
const INDEXABLE_SUBJECTS = [
  "goal",
  "key_result",
  "kpi",
  "initiative",
  "task",
  "document",
  "comment",
  "check_in",
] as const;

export type IndexableSubject = (typeof INDEXABLE_SUBJECTS)[number];

export function isIndexableSubject(
  subjectType: string,
): subjectType is IndexableSubject {
  return (INDEXABLE_SUBJECTS as readonly string[]).includes(subjectType);
}

/** The automatic set plus the ones a write names explicitly. */
const INDEXABLE_TYPES = [...INDEXABLE_SUBJECTS, "session"] as const;

export type IndexableType = (typeof INDEXABLE_TYPES)[number];

export function isIndexableType(value: string): value is IndexableType {
  return (INDEXABLE_TYPES as readonly string[]).includes(value);
}

/** What one row in the index holds. */
export interface IndexableRow {
  readonly title: string;
  readonly body: string | null;
  readonly contextId: string;
}

/** Which resource's context decides who sees this type's rows. */
const CONTEXT_FOR: Readonly<Record<IndexableType, string>> = {
  goal: "goal",
  // A key result inherits its goal's context, which is the rule the whole
  // product follows: "no such key result" and "not yours to see" answer alike.
  key_result: "goal",
  // A KPI has no context of its own yet, and a measure everybody can read is
  // what §6 describes. The workspace's context is what every active member
  // holds, so a KPI is searchable by the same people who can open the grid.
  kpi: "workspace",
  initiative: "initiative",
  task: "task",
  document: "document",
  comment: "comment",
  // A check-in belongs to its goal, the same way its embedding does.
  check_in: "goal",
  // A session belongs to its space, or to the workspace when it has none.
  session: "space",
};

const first = <T>(rows: readonly T[]): T | null => rows[0] ?? null;

const plain = (body: unknown): string | null =>
  body === null || body === undefined
    ? null
    : excerptRichText(body as never, 8000) || null;

/**
 * One entity as the index should hold it, or null when there is nothing to
 * index and the projection should be removed.
 *
 * Read at worker time rather than carried on the outbox row, for the reason the
 * embedding worker records: a row written three edits ago would index text the
 * product no longer holds.
 */
export async function indexableRowInTx(
  tx: OperationTx,
  workspaceId: string,
  entityType: IndexableType,
  entityId: string,
): Promise<IndexableRow | null> {
  const found = await contentFor(tx, workspaceId, entityType, entityId);
  if (!found) {
    return null;
  }

  const context = await resolveSubjectContext(
    tx,
    CONTEXT_FOR[entityType],
    found.contextResourceId,
    workspaceId,
  );
  if (!context) {
    // The entity is there and its context is not, which happens when the thing
    // it hangs off was deleted between the write and the worker. No row.
    return null;
  }

  return {
    title: found.title,
    body: found.body,
    contextId: context.contextId,
  };
}

interface FoundContent {
  readonly title: string;
  readonly body: string | null;
  /** The id the context resolver above is asked about. */
  readonly contextResourceId: string;
}

async function contentFor(
  tx: OperationTx,
  workspaceId: string,
  entityType: IndexableType,
  entityId: string,
): Promise<FoundContent | null> {
  switch (entityType) {
    case "goal": {
      const row = first(
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
      return row
        ? {
            title: row.title,
            body: plain(row.description),
            contextResourceId: entityId,
          }
        : null;
    }
    case "key_result": {
      const row = first(
        await tx
          .select({ title: keyResults.title, goalId: keyResults.goalId })
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
      return row
        ? { title: row.title, body: null, contextResourceId: row.goalId }
        : null;
    }
    case "kpi": {
      const row = first(
        await tx
          .select({ title: kpis.title, description: kpis.description })
          .from(kpis)
          .where(
            activeOnly(
              kpis,
              eq(kpis.workspaceId, workspaceId),
              eq(kpis.id, entityId),
            ),
          )
          .limit(1),
      );
      return row
        ? {
            title: row.title,
            body: plain(row.description),
            contextResourceId: workspaceId,
          }
        : null;
    }
    case "initiative": {
      const row = first(
        await tx
          .select({
            title: initiatives.title,
            description: initiatives.description,
          })
          .from(initiatives)
          .where(
            activeOnly(
              initiatives,
              eq(initiatives.workspaceId, workspaceId),
              eq(initiatives.id, entityId),
            ),
          )
          .limit(1),
      );
      return row
        ? {
            title: row.title,
            body: plain(row.description),
            contextResourceId: entityId,
          }
        : null;
    }
    case "task": {
      const row = first(
        await tx
          .select({ title: tasks.title, description: tasks.description })
          .from(tasks)
          .where(
            activeOnly(
              tasks,
              eq(tasks.workspaceId, workspaceId),
              eq(tasks.id, entityId),
            ),
          )
          .limit(1),
      );
      return row
        ? {
            title: row.title,
            body: plain(row.description),
            contextResourceId: entityId,
          }
        : null;
    }
    case "document": {
      const row = first(
        await tx
          .select({
            title: documents.title,
            body: documents.body,
            state: documents.state,
          })
          .from(documents)
          .where(
            activeOnly(
              documents,
              eq(documents.workspaceId, workspaceId),
              eq(documents.id, entityId),
            ),
          )
          .limit(1),
      );
      if (!row) {
        return null;
      }
      // **A draft is not indexed at all.** The index has one context per row and
      // no notion of an author, so a draft in it would be findable by everybody
      // who can read its subject: exactly the leak the draft rule exists to
      // stop. It is indexed the moment it is published, which is the moment
      // anybody else is allowed to know it exists.
      if (row.state !== "published") {
        return null;
      }
      return {
        title: row.title,
        body: plain(row.body),
        contextResourceId: entityId,
      };
    }
    case "comment": {
      const row = first(
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
      const text = plain(row.body);
      return text
        ? { title: text.slice(0, 120), body: text, contextResourceId: entityId }
        : null;
    }
    case "check_in": {
      const row = first(
        await tx
          .select({
            narrative: checkIns.narrative,
            state: checkIns.state,
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
      if (row?.state !== "published") {
        // A draft check-in is visible only to its author (P3-T07), so indexing
        // one would put unpublished text into a shared index.
        return null;
      }
      const text = plain(row.narrative);
      return text
        ? {
            title: text.slice(0, 120),
            body: text,
            contextResourceId: row.subjectId,
          }
        : null;
    }
    case "session": {
      const row = first(
        await tx
          .select({ title: okrSessions.title, spaceId: okrSessions.spaceId })
          .from(okrSessions)
          .where(
            activeOnly(
              okrSessions,
              eq(okrSessions.workspaceId, workspaceId),
              eq(okrSessions.id, entityId),
            ),
          )
          .limit(1),
      );
      if (!row) {
        return null;
      }
      return {
        title: row.title,
        body: null,
        // A session with no space belongs to the workspace, which is what
        // `embeddings/governing.ts` already decided for the same rows.
        contextResourceId: row.spaceId ?? workspaceId,
      };
    }
    default:
      return null;
  }
}
