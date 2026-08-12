import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Invitations (TECHNICAL-PLAN §4.1, P2-T04). See migration 0010 for the
 * reasoning behind each column; this is the drizzle view of the same table.
 */
export const inviteLinks = pgTable("invite_links", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  mode: text("mode", { enum: ["workspace", "personal"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  email: text("email"),
  allowedDomains: text("allowed_domains").array(),
  invitedByMemberId: uuid("invited_by_member_id").references(
    () => workspaceMembers.id,
  ),
  memberId: uuid("member_id").references(() => workspaceMembers.id),
  useCount: integer("use_count").notNull().default(0),
  maxUses: integer("max_uses"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type InviteLink = typeof inviteLinks.$inferSelect;
export type InviteMode = InviteLink["mode"];
