import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * The relationship access model (TECHNICAL-PLAN §4.1, P2-T01).
 *
 * `access_contexts` is one row per protected aggregate: the thing being
 * shared. `access_groups` is the principal side: a workspace has exactly one
 * `workspace_standard` group and one `anonymous` group, a member has exactly
 * one `member` group of their own, and a space (P3-T01) has one
 * `space_standard` group per space. `access_group_memberships` enumerates who
 * currently belongs to a group whose membership is real data rather than
 * structural — `space_standard` today, and any future named group. It is
 * deliberately not used for `workspace_standard`: every active member of the
 * workspace already belongs to it by definition, so a membership row per
 * person would be state that exists only to be kept in sync with
 * `workspace_members`. `access_bindings` is the grant: a level on a context,
 * held by a group, optionally tagged with a role.
 */

export const accessContexts = pgTable("access_contexts", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const accessGroups = pgTable("access_groups", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: ["member", "workspace_standard", "space_standard", "anonymous"],
  }).notNull(),
  /** Set only for kind `member`: the one person this group speaks for. */
  memberId: uuid("member_id").references(() => workspaceMembers.id, {
    onDelete: "cascade",
  }),
  /** Set only for kind `space_standard`. No foreign key: spaces are P3-T01. */
  spaceId: uuid("space_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const accessGroupMemberships = pgTable("access_group_memberships", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  groupId: uuid("group_id")
    .notNull()
    .references(() => accessGroups.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const accessBindings = pgTable("access_bindings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  groupId: uuid("group_id")
    .notNull()
    .references(() => accessGroups.id, { onDelete: "cascade" }),
  contextId: uuid("context_id")
    .notNull()
    .references(() => accessContexts.id, { onDelete: "cascade" }),
  /** view 10 / comment 40 / edit 70 / full 100 (§4.1). Mirrors ACCESS_LEVELS. */
  level: integer("level").notNull(),
  tag: text("tag", {
    enum: ["champion", "reviewer", "sponsor", "facilitator", "coordinator"],
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AccessContext = typeof accessContexts.$inferSelect;
export type AccessGroup = typeof accessGroups.$inferSelect;
export type AccessGroupKind = AccessGroup["kind"];
export type AccessGroupMembership = typeof accessGroupMemberships.$inferSelect;
export type AccessBinding = typeof accessBindings.$inferSelect;
export type AccessRoleTag = NonNullable<AccessBinding["tag"]>;
