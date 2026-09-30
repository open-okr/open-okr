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
import { embedFor } from "../../lib/embedder";
import { requireWorkspace } from "../../lib/workspace";
import {
  EMPTY_ANSWER,
  type PaletteAnswer,
  type PaletteHit,
} from "./palette-groups.ts";

/** The longest phrase the palette sends, which is the jump's own limit. */
const PHRASE_LIMIT = 200;

/**
 * The shortest phrase worth a semantic search. One or two letters carry no
 * meaning to embed, and each one would be a model call per keystroke.
 */
const SEMANTIC_MIN_LENGTH = 3;

async function paletteContext() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

const asHit = (hit: {
  entityType: string;
  entityId: string;
  title: string;
  snippet: string;
  href: string;
}): PaletteHit => ({
  entityType: hit.entityType,
  entityId: hit.entityId,
  title: hit.title,
  snippet: hit.snippet,
  href: hit.href,
});

/**
 * The palette's fast answer: the jump, by short code and by name, and full
 * text (completeness review M-21).
 *
 * **Never waits on a model.** No embedding function is passed, so this is
 * Postgres alone and answers with the AI provider off exactly as with it on.
 * The semantic half is `paletteRelatedAction`, asked beside this one, so a
 * slow provider delays the Related group and nothing else.
 */
export async function paletteSearchAction(
  text: string,
): Promise<PaletteAnswer> {
  const phrase = text.trim().slice(0, PHRASE_LIMIT);
  if (phrase === "") {
    return EMPTY_ANSWER;
  }
  const context = await paletteContext();

  try {
    // Three reads, independent of one another, so asked together. The short
    // code comes first in the list because somebody who typed one wants the
    // thing and not a list with the thing in it; a phrase that is not a code
    // answers null for the cost of one indexed lookup.
    const [code, named, hits] = await Promise.all([
      phrase.length <= 40
        ? callAction(context, "search.jump", { shortId: phrase })
        : Promise.resolve(null),
      callAction(context, "search.entities", { text: phrase, limit: 8 }),
      callAction(context, "search.query", { text: phrase, limit: 12 }),
    ]);

    const goTo = [
      ...(code ? [code] : []),
      ...named.filter(
        (one) =>
          !(
            code &&
            one.entityType === code.entityType &&
            one.entityId === code.entityId
          ),
      ),
    ].map((one) => ({
      entityType: one.entityType,
      entityId: one.entityId,
      title: one.title,
      href: one.href,
    }));

    return { goTo, hits: hits.map(asHit), error: null };
  } catch (error) {
    if (error instanceof OperationError) {
      return { ...EMPTY_ANSWER, error: error.message };
    }
    throw error;
  }
}

/**
 * The palette's Related group: what the semantic index found and full text
 * did not (UIUX-PLAN §4 S-32, "semantic results blend in when available").
 *
 * **Empty with the provider off, and nothing is asked.** With no embedding
 * function `search.query` never builds its semantic source, so no model is
 * called and the embeddings index is not read. The palette then draws no
 * Related group at all, which is §4's rule for every AI affordance.
 *
 * **Access is decided by the retrieval, not here.** Every passage the semantic
 * index returns is checked against the reader through the access getter before
 * it is ranked, the same check the copilot's citations use.
 */
export async function paletteRelatedAction(
  text: string,
): Promise<readonly PaletteHit[]> {
  const phrase = text.trim().slice(0, PHRASE_LIMIT);
  if (phrase.length < SEMANTIC_MIN_LENGTH) {
    return [];
  }
  const context = await paletteContext();
  const embed = await embedFor(context.workspaceId);
  if (!embed) {
    return [];
  }
  try {
    const hits = await callAction({ ...context, embed }, "search.query", {
      text: phrase,
      limit: 12,
    });
    return hits.filter((hit) => hit.semantic).map(asHit);
  } catch {
    // Any failure, the provider's included, leaves the palette as it would be
    // with no provider at all (UIUX-PLAN §4, "AI degradation": no dead
    // buttons, no errors). The words that did match are already on screen
    // from the fast answer, and a refusal about the reader would have been
    // said there too.
    return [];
  }
}

/**
 * One list as a file (P5-T13, both formats at P5-T15).
 *
 * The refusal comes back as a sentence rather than a thrown error, so a member
 * who may not export hears why instead of watching a button do nothing.
 */
export async function exportListAction(
  list: "goals" | "initiatives" | "tasks" | "kpis",
  format: "csv" | "xlsx" = "csv",
): Promise<{
  filename: string;
  csv: string | null;
  xlsxBase64: string | null;
  rowCount: number;
  queued: boolean;
  runId: string | null;
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
      { list, format },
    );
    return { ...outcome, error: null };
  } catch (error) {
    if (error instanceof OperationError) {
      return {
        filename: "",
        csv: null,
        xlsxBase64: null,
        rowCount: 0,
        queued: false,
        runId: null,
        error: error.message,
      };
    }
    throw error;
  }
}

/**
 * The exports this member has asked for (P5-T15).
 *
 * Read on the server and rendered beside the button, so somebody who queued a
 * large one has a row to come back to rather than a tab to keep open.
 */
export async function myExportsAction() {
  const { session, workspace } = await requireWorkspace();
  return callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "exports.mine",
    { limit: 10 },
  );
}
