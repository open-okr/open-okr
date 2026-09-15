import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

/**
 * The tenant record (TECHNICAL-PLAN §4.13, P8-T02a).
 *
 * Design: `docs/design/p8-t01a-tenant-lifecycle.md`. Cloud only. A
 * self-hosted instance has this table and no rows in it, and every product
 * read behaves identically either way, because no product read asks.
 *
 * See migration 0082 for the row-level security policy, the check that ties
 * `closed_at` to the closed state, and the partial index the retention sweep
 * reads.
 *
 * **Nothing outside `packages/core/src/tenancy` and the operator console may
 * import this.** `pnpm check:boundaries` refuses it, because a plan key read
 * on the product path is a fork between self-host and cloud that stays
 * invisible until a self-hosted instance meets the null.
 */
export const TENANT_STATES = ["active", "suspended", "closed"] as const;

export type TenantState = (typeof TENANT_STATES)[number];

export const tenants = pgTable("tenants", {
  /** The primary key is the workspace. One tenant per workspace, by the key. */
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  state: text("state", { enum: TENANT_STATES }).notNull().default("active"),
  /** Null is the free tier, which needs no catalogue row. */
  planKey: text("plan_key"),
  /** Null means unlimited. */
  seats: integer("seats"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /** Recorded, never routed on. */
  region: text("region").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Tenant = typeof tenants.$inferSelect;
