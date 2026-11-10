import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

/**
 * The tenant record (TECHNICAL-PLAN §4.13, P8-T02a).
 *
 * Design: `docs/design/tenant-lifecycle.md`. Cloud only. A
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
  /**
   * When a trial ends (docs/design/tenant-lifecycle.md §11). The hourly sweep
   * settles it once the date passes, and clears it; choosing a plan clears it
   * too. A past date is never a state.
   */
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  /**
   * The sweep made it read-only because its people do not fit the default
   * plan, as billing's flag does for a subscription. Read only while
   * suspended; cleared on every lifecycle move. Migration 0158.
   */
  suspendedByTrial: boolean("suspended_by_trial").notNull().default(false),
  /**
   * When the owners and administrators were told the trial ends in seven
   * days. Cleared whenever the end date moves. Migration 0158.
   */
  trialRemindedAt: timestamp("trial_reminded_at", { withTimezone: true }),
  /** Recorded, never routed on. */
  region: text("region").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  /**
   * True only when the owner closed it while it was active, so reopening it is
   * theirs too (docs/design/workspace-erasure.md §3). Migration 0148.
   */
  ownerMayReopen: boolean("owner_may_reopen").notNull().default(false),
  /**
   * When erasure claimed it (docs/design/workspace-erasure.md §4). Once set,
   * nothing reopens it, and its audit rows may be deleted. Migration 0149.
   */
  erasingAt: timestamp("erasing_at", { withTimezone: true }),
  /**
   * When the owners and administrators were told it is deleted in seven days.
   * Cleared on every lifecycle move. Migration 0150.
   */
  erasureRemindedAt: timestamp("erasure_reminded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Tenant = typeof tenants.$inferSelect;
