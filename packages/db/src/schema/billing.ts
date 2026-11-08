import {
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces.ts";

/**
 * A workspace's account with a payment provider (docs/design/billing.md §4).
 *
 * See migration 0145. Vendor knowledge, like `tenants`, so nothing outside
 * `packages/core/src/billing`, the tenancy module and the operator console may
 * import it: `pnpm check:boundaries` refuses it.
 */
export const billingAccounts = pgTable(
  "billing_accounts",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    customerRef: text("customer_ref").notNull(),
    subscriptionRef: text("subscription_ref"),
    /** The provider's own word for it. */
    status: text("status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** So a billing event never lifts a suspension an operator imposed. */
    suspendedByBilling: boolean("suspended_by_billing")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    unique("billing_accounts_customer_unique").on(
      table.provider,
      table.customerRef,
    ),
  ],
);

export type BillingAccount = typeof billingAccounts.$inferSelect;

/** What makes a repeated webhook delivery do nothing. */
export const billingEvents = pgTable(
  "billing_events",
  {
    provider: text("provider").notNull(),
    eventRef: text("event_ref").notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.eventRef] })],
);
