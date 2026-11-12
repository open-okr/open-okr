import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { apiTokens } from "./api-tokens.ts";
import { oauthGrants } from "./oauth.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * One row for every call an external agent makes (migration 0153,
 * docs/design/agent-tool-calls.md, plan 0.7.0 A2), and for every read the
 * copilot makes as a member (migration 0169, plan 0.9.0 L3).
 *
 * Never an argument value, a result or a refusal sentence (D2). No
 * `deleted_at`: an operational log with a retention window, hard-deleted by
 * its sweep, as the migration's marker says.
 */
export const TOOL_CALL_OUTCOMES = [
  "ok",
  "unknown_tool",
  "outside_toolsets",
  "refused_scope",
  "invalid_input",
  "refused",
  "failed",
] as const;

export type ToolCallOutcome = (typeof TOOL_CALL_OUTCOMES)[number];

/**
 * Where a call came from. `mcp` is an external agent through a grant or a
 * token; `copilot` is the member's own copilot reading as them, with neither
 * (migration 0169, docs/design/copilot-live-data.md 3.6).
 */
export const AI_TOOL_CALL_SOURCES = ["mcp", "copilot"] as const;

export type AiToolCallSource = (typeof AI_TOOL_CALL_SOURCES)[number];

export const aiToolCalls = pgTable("ai_tool_calls", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id),
  grantId: uuid("grant_id").references(() => oauthGrants.id, {
    onDelete: "cascade",
  }),
  tokenId: uuid("token_id").references(() => apiTokens.id, {
    onDelete: "cascade",
  }),
  source: text("source", { enum: AI_TOOL_CALL_SOURCES })
    .notNull()
    .default("mcp"),
  tool: text("tool"),
  scope: text("scope", { enum: ["read", "write", "destructive"] }),
  outcome: text("outcome", { enum: TOOL_CALL_OUTCOMES }).notNull(),
  refusalCode: text("refusal_code", {
    enum: ["forbidden", "not_found", "conflict"],
  }),
  targetIds: uuid("target_ids").array().notNull().default([]),
  durationMs: integer("duration_ms").notNull(),
  calledAt: timestamp("called_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
