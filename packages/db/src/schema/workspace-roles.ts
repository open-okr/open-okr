import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Workspace roles and their permission matrix (P8-G13a, migration 0108,
 * docs/design/workspace-roles.md).
 *
 * A role is a level per domain and nothing else. It does not replace the
 * relationship model in `access.ts`: `can()` takes the maximum over the
 * bindings that reach a member and, now, over the level their role grants for
 * the resource type being asked about. A champion keeps their binding and
 * outranks any role that grants less.
 *
 * `workspace_members.role_id` is declared on the member table rather than
 * here, beside the other member columns. It is nullable, and null means the
 * member holds only what their bindings give them, which is what every member
 * held before this table existed and what a guest and an agent keep.
 */

/** The four roles a workspace is born with. `owner` cannot be edited. */
export const BUILTIN_ROLE_KEYS = [
  "owner",
  "admin",
  "member",
  "viewer",
] as const;
export type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number];

/**
 * The resource types a role can speak about: an access context's own
 * `resource_type`, so the matrix needs no translation to reach the resolver.
 *
 * `blob` is deliberately absent. A file's access follows the goal or space it
 * hangs off, and a role that could grant it separately would be a second
 * answer to a question the parent already answers.
 */
export const ROLE_DOMAINS = [
  "goal",
  "kpi",
  "initiative",
  "task",
  "comment",
  "space",
  "workspace",
] as const;
export type RoleDomain = (typeof ROLE_DOMAINS)[number];

export const workspaceRoles = pgTable("workspace_roles", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Null for a role an administrator added. */
  builtinKey: text("builtin_key", { enum: BUILTIN_ROLE_KEYS }),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  roleId: uuid("role_id")
    .notNull()
    .references(() => workspaceRoles.id, { onDelete: "cascade" }),
  /**
   * Plain text rather than the enum above, matching the migration. A resource
   * type added by a later phase must not need a schema change here before a
   * role can speak about it, and a domain that matches no context grants
   * nothing to nobody.
   */
  domain: text("domain").notNull(),
  /** 0, 10, 40, 70 or 100, the §4.1 ladder with nothing added. */
  level: integer("level").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type WorkspaceRole = typeof workspaceRoles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
