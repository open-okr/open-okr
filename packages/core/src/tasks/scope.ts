/**
 * What a board is of, and who may read it (TECHNICAL-PLAN §4.9, completeness
 * review M-02).
 *
 * REQUIREMENTS §4 Pillar C asks for "a kanban board across a space, an
 * initiative or a key result". There is no board table: a board is a view over
 * `tasks`, so what makes one board different from another is the question it
 * asks and the thing it asks it about. This file holds the thing.
 *
 * **The scope is read through the access getter before a card is.** The cards
 * were always filtered one by one, so nothing leaked, but a board of a space,
 * an initiative or a key result the reader cannot see answered with an empty
 * board rather than not-found. That was the wrong answer to the question, and
 * it made the board's live stream a door that opened for anybody: its route
 * treated a successful read as the access check. So the scope is decided here,
 * the way every other protected read decides its subject.
 *
 * | Scope | Decided by |
 * |---|---|
 * | A space | The space's own context |
 * | An initiative | The initiative's own context |
 * | A key result | Its goal's context. A key result owns none (`access/reads.ts`) |
 */
import {
  activeOnly,
  goals,
  initiatives,
  keyResults,
  spaces,
  type WorkspaceTx,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { getAccessScoped } from "../access/reads.ts";
import { OperationError } from "../operations/operation.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

export const BOARD_SCOPE_KINDS = ["space", "initiative", "key_result"] as const;
type BoardScopeKind = (typeof BOARD_SCOPE_KINDS)[number];

/** One thing a board can be of. */
export interface BoardScope {
  readonly kind: BoardScopeKind;
  readonly id: string;
}

/** The three filters `tasks.board` takes. */
interface BoardFilters {
  readonly spaceId?: string | undefined;
  readonly initiativeId?: string | undefined;
  readonly keyResultId?: string | undefined;
}

/**
 * Every scope an input names, most specific first.
 *
 * The filters combine, so a caller may name a space and a key result at once
 * and get the key result's work in that space. Each one named is checked, not
 * only the one the heading describes: a reader who may see the key result but
 * not the space should not learn which of that space's cards serve it.
 */
export function boardScopesOf(input: BoardFilters): BoardScope[] {
  return [
    ...(input.keyResultId
      ? [{ kind: "key_result" as const, id: input.keyResultId }]
      : []),
    ...(input.initiativeId
      ? [{ kind: "initiative" as const, id: input.initiativeId }]
      : []),
    ...(input.spaceId ? [{ kind: "space" as const, id: input.spaceId }] : []),
  ];
}

/**
 * Refuses a scope this member cannot read, with the getter's own not-found.
 *
 * A missing scope and a hidden one answer alike, which is the rule every
 * protected read follows (§8.1 layer 2).
 */
export async function requireBoardScope<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  input: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly scope: BoardScope;
  },
): Promise<void> {
  const { scope } = input;
  if (scope.kind === "space" || scope.kind === "initiative") {
    await getAccessScoped(tx, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      resourceType: scope.kind,
      resourceId: scope.id,
    });
    return;
  }

  const notFound = () =>
    new OperationError(
      "not_found",
      "No such key result, or you do not have access to it.",
    );
  const [row] = await tx
    .select({ goalId: keyResults.goalId })
    .from(keyResults)
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, input.workspaceId),
        eq(keyResults.id, scope.id),
      ),
    )
    .limit(1);
  if (!row) {
    throw notFound();
  }
  try {
    await getAccessScoped(tx, {
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      resourceType: "goal",
      resourceId: row.goalId,
    });
  } catch (error) {
    // The goal's own sentence would name a goal the caller asked nothing
    // about. Same answer, in the words of the thing they did ask for.
    if (error instanceof OperationError && error.code === "not_found") {
      throw notFound();
    }
    throw error;
  }
}

/** What a board's heading says it is of, and where new work on it goes. */
export interface BoardScopeDescription {
  readonly kind: BoardScopeKind;
  readonly id: string;
  /** The space's name, the initiative's title or the key result's title. */
  readonly title: string;
  /** The initiative's space, or the key result's goal. Null for a space. */
  readonly parentTitle: string | null;
  /**
   * The space a task added on this board lands in. Null only for a key result
   * whose goal belongs to no space, where the person adding work chooses.
   */
  readonly spaceId: string | null;
  /** The key result's goal, so its heading can link there. */
  readonly goalId: string | null;
}

/**
 * The heading's facts, read once the scope has passed `requireBoardScope`.
 *
 * Never called before the check: it reads titles, and a title is exactly what
 * a reader who cannot see the scope must not be handed.
 */
export async function describeBoardScope<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  scope: BoardScope,
): Promise<BoardScopeDescription> {
  const gone = () =>
    new OperationError("not_found", "No such board, or it has gone.");

  if (scope.kind === "space") {
    const [row] = await tx
      .select({ name: spaces.name })
      // openokr:allow-raw-read: the space's name for the board's heading,
      // read only after requireBoardScope has passed this reader through the
      // getter for this same space. Every caller checks first.
      .from(spaces)
      .where(
        activeOnly(
          spaces,
          eq(spaces.workspaceId, workspaceId),
          eq(spaces.id, scope.id),
        ),
      )
      .limit(1);
    if (!row) {
      throw gone();
    }
    return {
      ...scope,
      title: row.name,
      parentTitle: null,
      spaceId: scope.id,
      goalId: null,
    };
  }

  if (scope.kind === "initiative") {
    const [row] = await tx
      .select({
        title: initiatives.title,
        spaceId: initiatives.spaceId,
        spaceName: spaces.name,
      })
      .from(initiatives)
      .innerJoin(spaces, eq(spaces.id, initiatives.spaceId))
      .where(
        activeOnly(
          initiatives,
          eq(initiatives.workspaceId, workspaceId),
          eq(initiatives.id, scope.id),
        ),
      )
      .limit(1);
    if (!row) {
      throw gone();
    }
    return {
      ...scope,
      title: row.title,
      parentTitle: row.spaceName,
      spaceId: row.spaceId,
      goalId: null,
    };
  }

  const [row] = await tx
    .select({
      title: keyResults.title,
      goalId: goals.id,
      goalTitle: goals.title,
      spaceId: goals.spaceId,
    })
    .from(keyResults)
    .innerJoin(goals, eq(goals.id, keyResults.goalId))
    .where(
      activeOnly(
        keyResults,
        eq(keyResults.workspaceId, workspaceId),
        eq(keyResults.id, scope.id),
      ),
    )
    .limit(1);
  if (!row) {
    throw gone();
  }
  return {
    ...scope,
    title: row.title,
    parentTitle: row.goalTitle,
    spaceId: row.spaceId,
    goalId: row.goalId,
  };
}

/**
 * Which of these members may be shown as having this board open, by name
 * (completeness review M-02).
 *
 * The board's presence is announced on a realtime channel by whoever opened the
 * board's stream, and the stream only opens for a reader who passed
 * `requireBoardScope`. That is checked again here, per member, at the moment a
 * name is about to be drawn, for two reasons:
 *
 * - access changes while a tab stays open. A member suspended or taken out of
 *   the space should vanish from everybody's board, not linger until they
 *   close theirs;
 * - a name is the one thing presence adds that the event does not carry. The
 *   event holds identifiers only (the realtime port's own rule), so the name
 *   is read here, on the server, for the viewer who will see it.
 *
 * **Only members who can read the board, and only active ones.** An identifier
 * that fails either is dropped silently rather than shown as "somebody": a
 * placeholder would still tell a guest that a board they share has a reader
 * they may not know about.
 *
 * Returned in the order asked, so the avatars do not shuffle as the list is
 * re-read.
 */
export async function boardReaders(
  pool: Pool,
  input: {
    readonly workspaceId: string;
    /** The viewer, whose session the read runs under. */
    readonly userId: string;
    readonly scope: BoardScope;
    readonly memberIds: readonly string[];
  },
): Promise<{ readonly id: string; readonly name: string }[]> {
  if (input.memberIds.length === 0) {
    return [];
  }
  return withContext(
    drizzle(pool),
    { workspaceId: input.workspaceId, userId: input.userId },
    async (tx) => {
      const rows = await tx
        .select({ id: workspaceMembers.id, name: workspaceMembers.name })
        .from(workspaceMembers)
        .where(
          activeOnly(
            workspaceMembers,
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.status, "active"),
            inArray(workspaceMembers.id, [...input.memberIds]),
          ),
        );

      const readers = new Map<string, string>();
      for (const row of rows) {
        try {
          await requireBoardScope(tx, {
            workspaceId: input.workspaceId,
            memberId: row.id,
            scope: input.scope,
          });
          readers.set(row.id, row.name);
        } catch (error) {
          if (
            !(error instanceof OperationError && error.code === "not_found")
          ) {
            throw error;
          }
        }
      }

      return input.memberIds.flatMap((id) => {
        const name = readers.get(id);
        return name === undefined ? [] : [{ id, name }];
      });
    },
  );
}
