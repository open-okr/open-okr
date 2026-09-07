/**
 * Copilot threads and messages (AI-NATIVE-PLAN.md §7, P4-T14a-a).
 *
 * A conversation anchored to the workspace or to one entity. A thread belongs to
 * one member, because §2.4's grounded answering is "across everything the user
 * may see": a thread shared between two readers would answer differently
 * depending on who opened it.
 */
import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const AI_MESSAGE_ROLES = ["member", "assistant"] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

/** One thing an answer was grounded in. */
export interface AiCitation {
  readonly entityType: string;
  readonly entityId: string;
}

export const aiThreads = pgTable("ai_threads", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  /** Null for a whole-workspace thread, which is the side panel opened anywhere. */
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AiThread = typeof aiThreads.$inferSelect;

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => aiThreads.id, { onDelete: "cascade" }),
  role: text("role", { enum: AI_MESSAGE_ROLES }).notNull(),
  content: text("content").notNull(),
  /**
   * What the answer was grounded in.
   *
   * Stored rather than resolved at read time: a citation is a claim about what
   * this answer used, and that does not change when the content later does.
   * Whether the reader may see a cited thing is a different question, decided at
   * read time, and it is the one that matters for leaks.
   */
  citations: jsonb("citations").$type<AiCitation[]>().notNull().default([]),
  model: text("model"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  /** What the turn cost, priced by the host that made the call. */
  cost: numeric("cost", { precision: 12, scale: 6 }),
  /** Set when a stream was stopped before finishing (P4-T14a-b writes it). */
  stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AiMessage = typeof aiMessages.$inferSelect;
