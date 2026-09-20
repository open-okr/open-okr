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
  /**
   * The words. Empty only while a background run owns the row.
   *
   * Migration 0098 narrowed `ai_messages_content_present` to permit that and
   * nothing else: a run writes its message before there is an answer, and a
   * run that halts writes none at all with `runHaltedReason` saying why.
   */
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
  /**
   * When a background run began (P4-T14b-b).
   *
   * Null on a message a synchronous answer wrote, which is what an instance
   * with no relay draining its queue falls back to, and on every message
   * written before migration 0098. Null means there was never a run to
   * rejoin.
   */
  runStartedAt: timestamp("run_started_at", { withTimezone: true }),
  /**
   * When it finished, however it finished.
   *
   * **A run is in flight when `runStartedAt` is set and this is null.** That
   * is the one question every reader of this table asks, and the partial
   * index in 0098 is on exactly it.
   */
  runCompletedAt: timestamp("run_completed_at", { withTimezone: true }),
  /** Why it stopped early, in words for the reader. Null when it did not. */
  runHaltedReason: text("run_halted_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AiMessage = typeof aiMessages.$inferSelect;
