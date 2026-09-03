import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { accessContexts } from "./access.ts";
import { workspaces } from "./workspaces.ts";

/**
 * The full-text search index (TECHNICAL-PLAN §5, §9, P5-T13).
 *
 * **A projection, never a source of truth.** Every row is derived from
 * something else and refreshed by an outbox-driven worker, exactly as
 * `embeddings` is: the same write enqueues both, so the two indexes cannot
 * disagree about what exists. When a source row is soft-deleted its projection
 * is removed outright, because a surviving entry would leak a deleted title
 * into somebody's results.
 *
 * The `document` tsvector column is generated in the database (title at weight
 * A, body at weight B) and is not declared here: Drizzle has no generated-column
 * type, and a declaration that dropped the weighting would describe an index
 * the database does not have. The table has existed since migration 0003;
 * `context_id` arrived at 0067 and is what lets a query filter in SQL rather
 * than fetching and discarding.
 */
export const searchDocuments = pgTable("search_documents", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  title: text("title").notNull(),
  /** Plain text, already extracted from rich text by the caller. */
  body: text("body"),
  /**
   * The access context this row is visible through. Null is invisible to
   * everybody, which is the safe direction for a mistake to fall.
   */
  contextId: uuid("context_id").references(() => accessContexts.id, {
    onDelete: "cascade",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SearchDocumentRow = typeof searchDocuments.$inferSelect;
