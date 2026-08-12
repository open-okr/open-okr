import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { AI_PROVIDER_KINDS } from "./ai.ts";
import { MODEL_TIERS } from "./ai-models.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * The agent runtime (AI-NATIVE-PLAN.md §6.5, §7, P2-T17). See migration
 * 0018 for why `agent_runs` and `proposed_changes` carry no `deleted_at`.
 */
export const AGENT_KINDS = ["coach", "champion", "custom"] as const;
export const AGENT_SCHEDULES = ["manual", "continuous", "nightly"] as const;
export const AGENT_AUTONOMIES = [
  "sandbox",
  "propose",
  "scoped_direct",
] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];
export type AgentSchedule = (typeof AGENT_SCHEDULES)[number];
export type AgentAutonomy = (typeof AGENT_AUTONOMIES)[number];

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  name: text("name").notNull(),
  kind: text("kind", { enum: AGENT_KINDS }).notNull().default("custom"),
  persona: text("persona").notNull().default(""),
  planningInstructions: text("planning_instructions").notNull().default(""),
  executionInstructions: text("execution_instructions").notNull().default(""),
  provider: text("provider", { enum: AI_PROVIDER_KINDS }),
  tier: text("tier", { enum: MODEL_TIERS }),
  schedule: text("schedule", { enum: AGENT_SCHEDULES })
    .notNull()
    .default("manual"),
  autonomy: text("autonomy", { enum: AGENT_AUTONOMIES })
    .notNull()
    .default("propose"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Agent = typeof agents.$inferSelect;

export const AGENT_RUN_STATUSES = [
  "planning",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** One decomposed unit of work. Planning writes the whole array once;
 * execution only ever advances `currentTaskIndex` through it. */
export interface AgentTask {
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly subjectType?: string;
  readonly subjectId?: string;
}

export interface AgentRunLogEntry {
  readonly at: string;
  readonly taskIndex: number;
  readonly kind: "denied" | "simulated" | "proposed" | "applied" | "error";
  readonly message: string;
}

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(),
  status: text("status", { enum: AGENT_RUN_STATUSES })
    .notNull()
    .default("planning"),
  tasks: jsonb("tasks").notNull().default([]).$type<readonly AgentTask[]>(),
  currentTaskIndex: integer("current_task_index").notNull().default(0),
  log: jsonb("log").notNull().default([]).$type<readonly AgentRunLogEntry[]>(),
  cost: numeric("cost", { precision: 12, scale: 6 }).notNull().default("0"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AgentRun = typeof agentRuns.$inferSelect;

export const PROPOSED_CHANGE_STATUSES = [
  "pending",
  "applied",
  "dismissed",
] as const;
export type ProposedChangeStatus = (typeof PROPOSED_CHANGE_STATUSES)[number];

export const proposedChanges = pgTable("proposed_changes", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  runId: uuid("run_id")
    .notNull()
    .references(() => agentRuns.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  payload: jsonb("payload").notNull().default({}),
  subjectType: text("subject_type"),
  subjectId: uuid("subject_id"),
  status: text("status", { enum: PROPOSED_CHANGE_STATUSES })
    .notNull()
    .default("pending"),
  decidedByMemberId: uuid("decided_by_member_id").references(
    () => workspaceMembers.id,
  ),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ProposedChange = typeof proposedChanges.$inferSelect;
