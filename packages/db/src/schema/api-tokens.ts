import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Tokens for the public surfaces (TECHNICAL-PLAN §14, P5-T07a).
 *
 * Migration 0058 holds the policy, including the second key that lets the
 * lookup run before a workspace is known, and the reasoning for each column.
 */

/**
 * Which door a token opens.
 *
 * Stored, not inferred from the token's text. §14 asks for the REST surface and
 * the agent endpoint to have separate audiences, and the whole point is that a
 * token which is valid at one is refused at the other.
 */
export const TOKEN_AUDIENCES = ["rest", "mcp"] as const;
export type TokenAudience = (typeof TOKEN_AUDIENCES)[number];

/**
 * What a token may reach, in the registry's own terms.
 *
 * The same three words the action registry classifies every action with, so
 * "may this token run this action" is a set membership test rather than a
 * mapping table that can drift. A token holding `write` does not hold
 * `destructive`: removing something a person can see is a separate grant.
 */
export const TOKEN_SCOPES = ["read", "write", "destructive"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    audience: text("audience", { enum: TOKEN_AUDIENCES }).notNull(),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(),
    scopes: text("scopes").array().$type<TokenScope[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("api_tokens_member_idx").on(table.workspaceId, table.memberId),
  ],
);

export type ApiToken = typeof apiTokens.$inferSelect;
