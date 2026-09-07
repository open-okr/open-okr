import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import type { TokenScope } from "./api-tokens.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * The device login (TECHNICAL-PLAN §14, P5-T07c-b).
 *
 * Migration 0059 holds the policy, including the second key that lets the row be
 * written and read before a workspace is known, and the reasoning for each
 * column.
 */
export const deviceAuthorisations = pgTable("device_authorisations", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  /** Null until a member approves it in a browser. */
  workspaceId: uuid("workspace_id").references(() => workspaces.id, {
    onDelete: "cascade",
  }),
  deviceCodeHash: text("device_code_hash").notNull(),
  userCodeHash: text("user_code_hash").notNull(),
  clientName: text("client_name").notNull(),
  requestedScopes: text("requested_scopes")
    .array()
    .$type<TokenScope[]>()
    .notNull(),
  approvedMemberId: uuid("approved_member_id").references(
    () => workspaceMembers.id,
    { onDelete: "cascade" },
  ),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  deniedAt: timestamp("denied_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type DeviceAuthorisation = typeof deviceAuthorisations.$inferSelect;
