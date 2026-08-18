import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Embeddings for semantic retrieval (AI-NATIVE-PLAN.md §9, P4-T13).
 *
 * Each row is one chunk of one entity, embedded by one model. The content
 * hash lets the worker skip re-embedding when nothing changed.
 *
 * The vector column is typed as text here because Drizzle has no native
 * pgvector type. The migration conditionally creates a vector column when
 * pgvector is installed. Queries that need the vector use raw SQL through
 * the retrieval service, never through the Drizzle query builder.
 */
export const EMBEDDABLE_ENTITY_TYPES = [
  "goal",
  "key_result",
  "check_in",
  "blocker",
  "session",
  "document",
  "comment",
  "cycle",
  "kpi",
] as const;

export type EmbeddableEntityType = (typeof EMBEDDABLE_ENTITY_TYPES)[number];

export const embeddings = pgTable("embeddings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  chunkIndex: integer("chunk_index").notNull().default(0),
  content: text("content").notNull(),
  contentHash: text("content_hash").notNull(),
  model: text("model"),
  dimensions: integer("dimensions"),
  /** Stored as text in Drizzle; the migration may alter it to vector. */
  embedding: text("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Embedding = typeof embeddings.$inferSelect;
