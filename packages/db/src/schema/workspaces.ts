import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { users } from "./auth.ts";

/**
 * Workspaces and members (TECHNICAL-PLAN §4.1).
 *
 * Ids are generated here rather than by Postgres, because the plan asks for
 * time-ordered keys (§3) and an importer needs the key before the row exists.
 */

/** Branding, timezone, trusted domains and language: the §4.14 settings map. */
export interface WorkspaceSettings {
  readonly [key: string]: unknown;
}

/** A member's quiet hours, in their own timezone. */
export interface QuietHours {
  readonly start: string;
  readonly end: string;
}

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  state: text("state", { enum: ["active", "read_only", "frozen"] })
    .notNull()
    .default("active"),
  settings: jsonb("settings").$type<WorkspaceSettings>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * Indexes are declared in the migration, not here. Several of them are partial
 * (`where deleted_at is null`), and a Drizzle declaration that quietly dropped
 * the predicate would describe an index the database does not have.
 */
export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  /** Null for placeholders and for agents nobody has claimed yet. */
  userId: text("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  title: text("title"),
  avatarBlobId: uuid("avatar_blob_id"),
  timezone: text("timezone"),
  /** Self-referencing. The cycle-safe chain arrives with P2-T03. */
  managerId: uuid("manager_id"),
  kind: text("kind", { enum: ["human", "guest", "agent", "placeholder"] })
    .notNull()
    .default("human"),
  status: text("status", { enum: ["active", "invited", "suspended"] })
    .notNull()
    .default("active"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  /** Editor JSON plus its version, never Markdown. */
  bio: jsonb("bio"),
  bioVersion: integer("bio_version"),
  primaryChannel: text("primary_channel", {
    enum: ["app", "email", "slack", "teams", "whatsapp", "telegram"],
  })
    .notNull()
    .default("email"),
  quietHours: jsonb("quiet_hours").$type<QuietHours>(),
  /**
   * The address a placeholder is waiting to be claimed by (P6-T03a).
   *
   * Set only on an imported member nobody has signed in as. Null on every
   * member with a real account, whose address lives on the user row.
   */
  placeholderEmail: text("placeholder_email"),
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

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
