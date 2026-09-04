import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { keyResults } from "./goals.ts";
import { initiatives } from "./initiatives.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Tasks, their assignees and their checklists (TECHNICAL-PLAN §4.9, P5-T11).
 *
 * There is no board table: a board is a view over `tasks` grouped by status for
 * a space, an initiative or a key result. Indexes and the four status values
 * live in the migration, the indexes because they are partial on
 * `deleted_at is null` and the statuses because a check constraint holds them
 * whichever path writes.
 */

export const TASK_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "done",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** What `ordering_state` holds: how the column was last laid out. */
export interface TaskOrderingState {
  /** The gap left between neighbours at the last normalisation. */
  readonly spacing?: number;
  /** When the column was last renumbered, as an ISO instant. */
  readonly normalisedAt?: string;
}

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  initiativeId: uuid("initiative_id").references(() => initiatives.id, {
    onDelete: "set null",
  }),
  keyResultId: uuid("key_result_id").references(() => keyResults.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  description: jsonb("description"),
  descriptionVersion: integer("description_version"),
  status: text("status", { enum: TASK_STATUSES }).notNull().default("backlog"),
  dueOn: date("due_on"),
  position: integer("position").notNull().default(0),
  orderingState: jsonb("ordering_state")
    .$type<TaskOrderingState>()
    .notNull()
    .default({}),
  legacyType: text("legacy_type"),
  legacyId: text("legacy_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const taskAssignees = pgTable("task_assignees", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const checklistItems = pgTable("checklist_items", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: boolean("done").notNull().default(false),
  position: integer("position").notNull().default(0),
  /** Where this line came from, when an import made it (P6-T04a). */
  legacyId: text("legacy_id"),
  legacyType: text("legacy_type", { enum: ["flowyteam", "csv"] }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Task = typeof tasks.$inferSelect;
export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
