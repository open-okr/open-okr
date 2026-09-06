import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Spaces: team homes (TECHNICAL-PLAN §4.2, P3-T01).
 *
 * A space owns an access context and a `space_standard` access group. Joining
 * the space is an `access_group_memberships` row in that group, which is why
 * adding a member gives them access to every aggregate the space owns without
 * a second grant anywhere.
 *
 * Indexes live in the migration, not here: several are partial
 * (`where deleted_at is null`, `where role = 'coordinator'`) and a Drizzle
 * declaration that dropped the predicate would describe an index the database
 * does not have.
 */

/** Team voting, strictness override and space defaults: the §4.14 space scope. */
export interface SpaceSettings {
  readonly [key: string]: unknown;
}

export const spaces = pgTable("spaces", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** One line, not editor JSON. §4.2 lists it without a rich-text marker. */
  mission: text("mission"),
  settings: jsonb("settings").$type<SpaceSettings>().notNull().default({}),
  /** Where this space came from, when an import made it (P6-T03a). */
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

/**
 * Who is in a space, and in what role.
 *
 * `manager` implies a full binding on the space's context. `coordinator` runs
 * the weekly session (METHOD.md §2.5, one per space) and gets a tagged binding
 * so the nudge engine can find them by role rather than by a column lookup. A
 * manager covers the coordinator's duties while no coordinator is named, which
 * is resolved on read in `packages/core/src/spaces/roles.ts` rather than stored
 * as a second row nobody would remember to remove.
 */
export const spaceMembers = pgTable("space_members", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["member", "manager", "coordinator"] })
    .notNull()
    .default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Space = typeof spaces.$inferSelect;
export type SpaceMember = typeof spaceMembers.$inferSelect;
export type SpaceRole = SpaceMember["role"];

/** Every space role, in ascending order of what it may do. */
export const SPACE_ROLES = ["member", "coordinator", "manager"] as const;
