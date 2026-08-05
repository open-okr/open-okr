/**
 * The outbox insert helper (TECHNICAL-PLAN §5, "the outbox contract").
 *
 * The only legal way to cause a side effect from a write path. Inserting the
 * row in the caller's transaction is what makes the domain change, the audit
 * row and the outbound message atomic: side effects never fire for a write
 * that rolled back, and a committed write always leaves its side effect
 * behind for the relay to drain.
 *
 * Calling a driver directly from a write path is the mistake this exists to
 * prevent, and `pnpm check:boundaries` fails the build when it happens.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** A JSON-serialisable payload. Consumers validate their own shape. */
export type OutboxPayload = Record<string, unknown>;

export interface OutboxMessage {
  /** Routing key, for example `goal.published`. Consumers subscribe by topic. */
  readonly topic: string;
  readonly payload: OutboxPayload;
  /**
   * The consumer's deduplication key, unique across the table. Build it from
   * the subject and the reason, for example `goal.published:<goalId>`, so a
   * retried write cannot enqueue the same side effect twice.
   */
  readonly idempotencyKey: string;
  /** Hold the row back until this time. Defaults to immediately. */
  readonly availableAt?: Date;
}

/** The `execute` surface shared by a drizzle database and its transactions. */
type Executor = Pick<NodePgDatabase, "execute">;

/**
 * Inserts one outbox row in the caller's transaction and returns its id.
 * Pass the transaction handle, never the pool: an insert outside the write's
 * transaction breaks the guarantee this helper exists for.
 */
export async function enqueueOutbox(
  executor: Executor,
  message: OutboxMessage,
): Promise<string> {
  const topic = message.topic.trim();
  if (topic === "") {
    throw new Error("Outbox topic must not be empty.");
  }
  const idempotencyKey = message.idempotencyKey.trim();
  if (idempotencyKey === "") {
    throw new Error("Outbox idempotency key must not be empty.");
  }

  const availableAt = message.availableAt ?? new Date();

  const result = await executor.execute<{ id: string }>(sql`
    insert into outbox (topic, payload, idempotency_key, available_at)
    values (${topic}, ${JSON.stringify(message.payload)}::jsonb, ${idempotencyKey}, ${availableAt.toISOString()})
    returning id
  `);

  const row = result.rows[0];
  if (!row) {
    throw new Error("Outbox insert returned no row.");
  }
  return row.id;
}
