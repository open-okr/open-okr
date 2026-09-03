"use server";

/**
 * The palette's and the search page's reads, as server actions (S-32, P5-T13).
 *
 * A read rather than a write, but a server action all the same: the palette
 * types into a client component and needs an answer without a page navigation.
 * Everything it can reach is what `search.query` already decided it can reach.
 */
import { callAction, OperationError } from "@openokr/core";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";

interface PaletteHit {
  readonly entityType: string;
  readonly entityId: string;
  readonly title: string;
  readonly snippet: string;
  readonly href: string;
  readonly semantic: boolean;
}

export interface PaletteAnswer {
  /** Set when the phrase was a short identifier and it resolved. */
  readonly jump: {
    readonly title: string;
    readonly href: string;
    readonly entityType: string;
  } | null;
  readonly hits: readonly PaletteHit[];
  readonly error: string | null;
}

const EMPTY: PaletteAnswer = { jump: null, hits: [], error: null };

export async function paletteSearchAction(
  text: string,
): Promise<PaletteAnswer> {
  const phrase = text.trim();
  if (phrase === "") {
    return EMPTY;
  }

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  try {
    // The jump first, because somebody who typed a code wants the thing, not a
    // list with the thing in it. A phrase that is not a code answers null and
    // costs one indexed lookup.
    const jump =
      phrase.length <= 40
        ? await callAction(context, "search.jump", { shortId: phrase })
        : null;

    const hits = await callAction(context, "search.query", {
      text: phrase,
      limit: 12,
    });

    return {
      jump: jump
        ? {
            title: jump.title,
            href: jump.href,
            entityType: jump.entityType,
          }
        : null,
      hits: hits.map((hit) => ({
        entityType: hit.entityType,
        entityId: hit.entityId,
        title: hit.title,
        snippet: hit.snippet,
        href: hit.href,
        semantic: hit.semantic,
      })),
      error: null,
    };
  } catch (error) {
    if (error instanceof OperationError) {
      return { ...EMPTY, error: error.message };
    }
    throw error;
  }
}

/**
 * One list as a file (P5-T13).
 *
 * The refusal comes back as a sentence rather than a thrown error, so a member
 * who may not export hears why instead of watching a button do nothing.
 */
export async function exportListAction(
  list: "goals" | "initiatives" | "tasks" | "kpis",
): Promise<{
  filename: string;
  csv: string | null;
  rowCount: number;
  queued: boolean;
  error: string | null;
}> {
  const { session, workspace } = await requireWorkspace();
  try {
    const outcome = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "exports.list",
      { list },
    );
    return { ...outcome, error: null };
  } catch (error) {
    if (error instanceof OperationError) {
      return {
        filename: "",
        csv: null,
        rowCount: 0,
        queued: false,
        error: error.message,
      };
    }
    throw error;
  }
}
