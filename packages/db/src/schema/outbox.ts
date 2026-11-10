import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The transactional outbox. Written only through `enqueueOutbox`, read only
 * by the relay in `packages/adapters`.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastError: text("last_error"),
    /** Null while retryable. Set once the relay gives up (P2-T06). */
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    /**
     * Whose row this is, for the relay's fair read (P8-T06b).
     *
     * Written by the column's own default, which reads the transaction's
     * tenant setting, so nothing in this package or above it passes it.
     * Null for rows written outside a tenant-scoped transaction and for
     * every row older than the migration that added it.
     *
     * **Never used to authorise anything.** This table is deliberately not
     * tenant-scoped and has no row-level policy; the column orders a queue
     * and nothing more.
     */
    workspaceId: uuid("workspace_id"),
    /**
     * When the relay last claimed the row, written only while an outbox rate
     * is set (docs/design/tenant-limits.md §10, migration 0159). The rate
     * counts claims in the last minute from this, so the outbox is its own
     * record of the rate and every relay agrees.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (table) => [
    index("outbox_pending_idx").on(table.availableAt, table.createdAt),
    // The fair read's index. Partial in the migration, which Drizzle does
    // not express here; the migration is the authority and this line exists
    // so a reader of the schema knows the index is there.
    index("outbox_fair_idx").on(table.workspaceId, table.createdAt, table.id),
    // Partial in the migration too: only rows claimed under a rate.
    index("outbox_claimed_at_idx").on(table.claimedAt),
  ],
);
