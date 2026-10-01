/**
 * Where a search result opens (UIUX-PLAN §4 S-32, completeness review M-21).
 *
 * **A key result, a check-in and a comment used to link to a page that was not
 * theirs.** The search read built every link as `/<kind>/<id>`, and three kinds
 * have no page of their own: a key result's id went to `/goals/<id>`, which is
 * not a goal, and opened the not-found page. So did every comment and every
 * check-in. The id in a link has to be the id of the thing whose page it is.
 *
 * **The parent is read, not guessed.** A key result opens its goal at the key
 * result's own row, a check-in opens the goal it was written against, and a
 * comment opens whatever it was written on. Semantic results reach further,
 * into blockers, review narratives and the notes a session keeps, and each of
 * those opens the goal or the session it belongs to.
 *
 * **No page means no link.** A type this does not know answers nothing, and
 * the caller drops the result rather than pointing it at the home page, which
 * is what the old fallback did.
 *
 * **Every caller has already filtered by access, with one gap this closes.** A
 * session's page is stricter than the index row that found it. The index, and
 * the retrieval behind the Related group, let through anybody who can view the
 * session's space, and every member can view every space so that it can be
 * found and joined. `sessions.read` also wants the reader in the space. So a
 * session, and a retro note, kudos, a learning or a draft that opens one, gets
 * a link only when the reader is in its space, and is otherwise dropped like a
 * result with no page. Offering a room that then refuses to open is the one
 * thing a palette must not do.
 */
import {
  activeOnly,
  blockers,
  checkIns,
  comments,
  keyResults,
  kudos,
  learnings,
  nextCycleDrafts,
  okrSessions,
  retroNotes,
  reviewNarratives,
  spaceMembers,
  withWorkspace,
} from "@openokr/db";
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import type { OperationTx } from "../operations/operation.ts";

export interface EntityRef {
  readonly entityType: string;
  readonly entityId: string;
}

/** The kinds with a page of their own that anybody who found them may open. */
const OWN_PAGE: Readonly<Record<string, (id: string) => string>> = {
  goal: (id) => `/goals/${id}`,
  kpi: (id) => `/kpis/${id}`,
  initiative: (id) => `/initiatives/${id}`,
  task: (id) => `/tasks/${id}`,
  document: (id) => `/documents/${id}`,
  space: (id) => `/spaces/${id}`,
  person: (id) => `/people/${id}`,
  // The cycle screen takes the cycle it shows as a parameter rather than a
  // path segment, because it is one screen with eight phases.
  cycle: (id) => `/cycle?cycle=${id}`,
};

/**
 * The sessions this member may open: one with no space, which belongs to the
 * workspace, or one in a space they are in. `sessions.read`'s own rule, as a
 * condition on `okr_sessions` so a list can apply it in the query.
 */
export function sessionOpenableBy(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
): SQL {
  return or(
    isNull(okrSessions.spaceId),
    inArray(
      okrSessions.spaceId,
      tx
        .select({ spaceId: spaceMembers.spaceId })
        .from(spaceMembers)
        .where(
          activeOnly(
            spaceMembers,
            eq(spaceMembers.workspaceId, workspaceId),
            eq(spaceMembers.memberId, memberId),
          ),
        ),
    ),
  ) as SQL;
}

const keyOf = (ref: EntityRef) => `${ref.entityType}:${ref.entityId}`;

const idsOf = (refs: readonly EntityRef[], type: string): string[] => [
  ...new Set(
    refs.filter((ref) => ref.entityType === type).map((ref) => ref.entityId),
  ),
];

/** Whether any of these needs a row read to find its page. */
const needsLookup = (refs: readonly EntityRef[]) =>
  refs.some((ref) => OWN_PAGE[ref.entityType] === undefined);

/**
 * Each result's page for this reader, keyed by `type:id`. A result with no page,
 * or with a page the reader may not open, is absent.
 *
 * Opens a transaction only when a result has no page of its own, so the common
 * case of goals, tasks and KPIs costs nothing beyond the search itself.
 */
export async function resolveHrefs(
  pool: Pool,
  workspaceId: string,
  readerId: string,
  refs: readonly EntityRef[],
): Promise<Map<string, string>> {
  if (!needsLookup(refs)) {
    return hrefsWithoutLookup(refs);
  }
  return withWorkspace(drizzle(pool), workspaceId, (rawTx) =>
    hrefsInTx(rawTx as unknown as OperationTx, workspaceId, readerId, refs),
  );
}

function hrefsWithoutLookup(refs: readonly EntityRef[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const ref of refs) {
    const page = OWN_PAGE[ref.entityType];
    if (page) {
      found.set(keyOf(ref), page(ref.entityId));
    }
  }
  return found;
}

/** The same, on a transaction the caller already holds. */
export async function hrefsInTx(
  tx: OperationTx,
  workspaceId: string,
  readerId: string,
  refs: readonly EntityRef[],
): Promise<Map<string, string>> {
  const found = hrefsWithoutLookup(refs);
  if (!needsLookup(refs)) {
    return found;
  }

  const sessionIds = idsOf(refs, "session");
  if (sessionIds.length > 0) {
    const rows = await tx
      .select({ id: okrSessions.id })
      .from(okrSessions)
      .where(
        and(
          activeOnly(
            okrSessions,
            eq(okrSessions.workspaceId, workspaceId),
            inArray(okrSessions.id, sessionIds),
          ),
          sessionOpenableBy(tx, workspaceId, readerId),
        ),
      );
    for (const row of rows) {
      found.set(`session:${row.id}`, `/session/${row.id}`);
    }
  }

  // Each kind below is answered by the page of something it belongs to. That
  // parent is collected first and resolved in one pass at the end, so a
  // comment on a key result is two short hops rather than a special case.
  const parents: { readonly child: string; readonly parent: EntityRef }[] = [];
  const belongsTo = (child: EntityRef, parent: EntityRef | null) => {
    if (parent) {
      parents.push({ child: keyOf(child), parent });
    }
  };

  const keyResultIds = idsOf(refs, "key_result");
  if (keyResultIds.length > 0) {
    const rows = await tx
      .select({ id: keyResults.id, goalId: keyResults.goalId })
      .from(keyResults)
      .where(
        activeOnly(
          keyResults,
          eq(keyResults.workspaceId, workspaceId),
          inArray(keyResults.id, keyResultIds),
        ),
      );
    for (const row of rows) {
      // The goal page draws every key result with this anchor, so the link
      // lands on the row rather than at the top of the goal.
      found.set(`key_result:${row.id}`, `/goals/${row.goalId}#kr-${row.id}`);
    }
  }

  const checkInIds = idsOf(refs, "check_in");
  if (checkInIds.length > 0) {
    const rows = await tx
      .select({
        id: checkIns.id,
        subjectType: checkIns.subjectType,
        subjectId: checkIns.subjectId,
      })
      .from(checkIns)
      .where(
        activeOnly(
          checkIns,
          eq(checkIns.workspaceId, workspaceId),
          inArray(checkIns.id, checkInIds),
        ),
      );
    for (const row of rows) {
      belongsTo(
        { entityType: "check_in", entityId: row.id },
        { entityType: row.subjectType, entityId: row.subjectId },
      );
    }
  }

  const commentIds = idsOf(refs, "comment");
  if (commentIds.length > 0) {
    const rows = await tx
      .select({
        id: comments.id,
        subjectType: comments.subjectType,
        subjectId: comments.subjectId,
      })
      .from(comments)
      .where(
        activeOnly(
          comments,
          eq(comments.workspaceId, workspaceId),
          inArray(comments.id, commentIds),
        ),
      );
    for (const row of rows) {
      belongsTo(
        { entityType: "comment", entityId: row.id },
        { entityType: row.subjectType, entityId: row.subjectId },
      );
    }
  }

  const blockerIds = idsOf(refs, "blocker");
  if (blockerIds.length > 0) {
    const rows = await tx
      .select({
        id: blockers.id,
        goalId: blockers.goalId,
        keyResultId: blockers.keyResultId,
      })
      .from(blockers)
      .where(
        activeOnly(
          blockers,
          eq(blockers.workspaceId, workspaceId),
          inArray(blockers.id, blockerIds),
        ),
      );
    for (const row of rows) {
      belongsTo(
        { entityType: "blocker", entityId: row.id },
        row.goalId
          ? { entityType: "goal", entityId: row.goalId }
          : row.keyResultId
            ? { entityType: "key_result", entityId: row.keyResultId }
            : null,
      );
    }
  }

  const narrativeIds = idsOf(refs, "review_narrative");
  if (narrativeIds.length > 0) {
    const rows = await tx
      .select({ id: reviewNarratives.id, goalId: reviewNarratives.goalId })
      .from(reviewNarratives)
      .where(
        activeOnly(
          reviewNarratives,
          eq(reviewNarratives.workspaceId, workspaceId),
          inArray(reviewNarratives.id, narrativeIds),
        ),
      );
    for (const row of rows) {
      belongsTo(
        { entityType: "review_narrative", entityId: row.id },
        { entityType: "goal", entityId: row.goalId },
      );
    }
  }

  // The notes a session keeps open the session they were written in.
  const sessionNoteIds = {
    retro_note: idsOf(refs, "retro_note"),
    kudos: idsOf(refs, "kudos"),
    learning: idsOf(refs, "learning"),
    next_cycle_draft: idsOf(refs, "next_cycle_draft"),
  };
  const inSession = (
    entityType: string,
    rows: readonly { id: string; sessionId: string | null }[],
  ) => {
    for (const row of rows) {
      belongsTo(
        { entityType, entityId: row.id },
        row.sessionId
          ? { entityType: "session", entityId: row.sessionId }
          : null,
      );
    }
  };
  if (sessionNoteIds.retro_note.length > 0) {
    inSession(
      "retro_note",
      await tx
        .select({ id: retroNotes.id, sessionId: retroNotes.sessionId })
        .from(retroNotes)
        .where(
          activeOnly(
            retroNotes,
            eq(retroNotes.workspaceId, workspaceId),
            inArray(retroNotes.id, sessionNoteIds.retro_note),
          ),
        ),
    );
  }
  if (sessionNoteIds.kudos.length > 0) {
    inSession(
      "kudos",
      await tx
        .select({ id: kudos.id, sessionId: kudos.sessionId })
        .from(kudos)
        .where(
          activeOnly(
            kudos,
            eq(kudos.workspaceId, workspaceId),
            inArray(kudos.id, sessionNoteIds.kudos),
          ),
        ),
    );
  }
  if (sessionNoteIds.learning.length > 0) {
    inSession(
      "learning",
      await tx
        .select({ id: learnings.id, sessionId: learnings.sessionId })
        .from(learnings)
        .where(
          activeOnly(
            learnings,
            eq(learnings.workspaceId, workspaceId),
            inArray(learnings.id, sessionNoteIds.learning),
          ),
        ),
    );
  }
  if (sessionNoteIds.next_cycle_draft.length > 0) {
    inSession(
      "next_cycle_draft",
      await tx
        .select({
          id: nextCycleDrafts.id,
          sessionId: nextCycleDrafts.sessionId,
        })
        .from(nextCycleDrafts)
        .where(
          activeOnly(
            nextCycleDrafts,
            eq(nextCycleDrafts.workspaceId, workspaceId),
            inArray(nextCycleDrafts.id, sessionNoteIds.next_cycle_draft),
          ),
        ),
    );
  }

  if (parents.length > 0) {
    // The recursion ends because every hop moves up to a kind nothing else
    // hangs off in turn: a comment on a check-in reaches its goal in two, and
    // that is the longest chain there is.
    const parentHrefs = await hrefsInTx(
      tx,
      workspaceId,
      readerId,
      parents.map((one) => one.parent),
    );
    for (const { child, parent } of parents) {
      const href = parentHrefs.get(keyOf(parent));
      if (href) {
        found.set(child, href);
      }
    }
  }

  return found;
}
