import {
  bigint,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";

/**
 * The instance-level audit chain (TECHNICAL-PLAN §8.2, P1/P2-hardening).
 *
 * `audit_events` (schema/audit.ts) is hash-chained per workspace and requires
 * one: `workspace_id` is not null there, because the plan's chain is a
 * property of a tenant. Some security events have no tenant to attach to —
 * a failed sign-in is a fact about an email address and an address, resolved
 * against `users` before any workspace membership is known, and can implicate
 * zero, one or several workspaces depending on who owns that address. This
 * table is the other chain: one sequence for the whole instance, for exactly
 * that kind of event. `packages/core/src/audit/instance-chain.ts` is its hash
 * logic, parallel to `audit/chain.ts` rather than sharing it, because the two
 * rows are shaped differently on purpose.
 */
export const instanceAuditEvents = pgTable("instance_audit_events", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  /** Position in the instance's own chain, from 1. */
  seq: bigint("seq", { mode: "number" }).notNull(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  prevHash: text("prev_hash").notNull(),
  rowHash: text("row_hash").notNull(),
});

export type InstanceAuditEvent = typeof instanceAuditEvents.$inferSelect;
