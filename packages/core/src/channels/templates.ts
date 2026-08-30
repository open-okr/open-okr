/**
 * The approved templates one workspace has at Meta (P5-T04b-a).
 *
 * **A mirror, replaced wholesale on every sync.** Nothing here is authored in
 * this product: the words are the customer's, the approval is Meta's, and the
 * only thing this repository decides is which of them a nudge uses, which is
 * P5-T04b-b. So a sync is not a merge with conflicts to resolve. It records what
 * Meta says now, and soft-deletes what Meta no longer lists.
 *
 * **Soft-deleted rather than removed**, so a mapping that referred to a template
 * Meta withdrew can still say which one it meant. Restoring it is an ordinary
 * upsert, which is why the unique index is not partial on `deleted_at`: one
 * template is one row for as long as the workspace exists.
 */
import { activeOnly, type WorkspaceTx, whatsappTemplates } from "@openokr/db";
import { asc, eq, notInArray } from "drizzle-orm";

/** One template as the caller hands it over, already read from Meta's shape. */
export interface SyncedTemplate {
  readonly metaId: string;
  readonly name: string;
  readonly language: string;
  readonly status: string;
  readonly category?: string | null;
  readonly bodyText?: string | null;
  readonly variables: number;
}

export interface SyncOutcome {
  /** Rows written, whether they were new or already there. */
  readonly recorded: number;
  /** Rows Meta no longer lists, marked so they stop being offered. */
  readonly withdrawn: number;
}

/**
 * Records what a sync found.
 *
 * Takes a transaction rather than a pool, because the caller is a registry write
 * action and the whole sync is one Operation: recording half a list would leave
 * a workspace offering templates that no longer exist beside ones that do.
 */
export async function recordTemplates(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly templates: readonly SyncedTemplate[];
    readonly now: Date;
  },
): Promise<SyncOutcome> {
  const seen = input.templates.map((template) => template.metaId);

  for (const template of input.templates) {
    // openokr:allow-mutation: the calling Operation's own transaction.
    await tx
      .insert(whatsappTemplates)
      .values({
        workspaceId: input.workspaceId,
        metaId: template.metaId,
        name: template.name,
        language: template.language,
        status: template.status,
        category: template.category ?? null,
        bodyText: template.bodyText ?? null,
        variables: template.variables,
        syncedAt: input.now,
      })
      .onConflictDoUpdate({
        target: [whatsappTemplates.workspaceId, whatsappTemplates.metaId],
        set: {
          name: template.name,
          language: template.language,
          status: template.status,
          category: template.category ?? null,
          bodyText: template.bodyText ?? null,
          variables: template.variables,
          syncedAt: input.now,
          updatedAt: input.now,
          // A template Meta had withdrawn and has listed again is the same
          // template, back.
          deletedAt: null,
        },
      });
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  const withdrawn = await tx
    .update(whatsappTemplates)
    .set({ deletedAt: input.now, updatedAt: input.now })
    .where(
      activeOnly(
        whatsappTemplates,
        eq(whatsappTemplates.workspaceId, input.workspaceId),
        // Everything Meta did not list. An empty sync withdraws all of them,
        // which is the true answer for an account whose templates were removed.
        ...(seen.length > 0
          ? [notInArray(whatsappTemplates.metaId, seen)]
          : []),
      ),
    )
    .returning({ id: whatsappTemplates.id });

  return { recorded: input.templates.length, withdrawn: withdrawn.length };
}

export interface StoredTemplate {
  readonly id: string;
  readonly metaId: string;
  readonly name: string;
  readonly language: string;
  readonly status: string;
  readonly category: string | null;
  readonly bodyText: string | null;
  readonly variables: number;
  readonly syncedAt: string;
}

/**
 * Every template this workspace has, newest sync first.
 *
 * Includes the ones Meta has not approved, because an administrator looking at
 * this screen wants to know that the template they submitted is still pending
 * rather than that it does not exist.
 */
export async function listTemplates(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<readonly StoredTemplate[]> {
  const rows = await tx
    .select()
    .from(whatsappTemplates)
    .where(
      activeOnly(
        whatsappTemplates,
        eq(whatsappTemplates.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(whatsappTemplates.name));

  return rows.map((row) => ({
    id: row.id,
    metaId: row.metaId,
    name: row.name,
    language: row.language,
    status: row.status,
    category: row.category,
    bodyText: row.bodyText,
    variables: row.variables,
    syncedAt: row.syncedAt.toISOString(),
  }));
}

/**
 * The templates a nudge may actually use.
 *
 * Approved only. A pending or rejected template is one Meta will refuse at send
 * time, and offering it on the mapping screen would move that refusal to seven
 * in the morning when a reminder is due.
 */
export async function usableTemplates(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<readonly StoredTemplate[]> {
  const all = await listTemplates(tx, workspaceId);
  return all.filter((template) => template.status.toUpperCase() === "APPROVED");
}
