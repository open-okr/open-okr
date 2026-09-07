import {
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { CAPACITY_VERDICTS, keyResults } from "./goals.ts";
import { spaces } from "./spaces.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * Initiatives and the key results they serve (TECHNICAL-PLAN §4.9,
 * METHOD.md §5.5, P5-T10a).
 *
 * `CAPACITY_VERDICTS` is imported rather than redeclared. It arrived with
 * `key_results.capacity` at P3-T04 and publish gate five reads both columns, so
 * a second list here is a second answer the gate would have to reconcile.
 *
 * Two invariants live in the migration as check constraints: a window that ends
 * before it starts, and the four statuses. Indexes are there too, partial on
 * `deleted_at is null`, which Drizzle cannot express.
 */

export const INITIATIVE_STATUSES = [
  "planned",
  "active",
  "done",
  "dropped",
] as const;
export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];

export const initiatives = pgTable("initiatives", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id")
    .notNull()
    .references(() => spaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: jsonb("description"),
  descriptionVersion: integer("description_version"),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => workspaceMembers.id),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  status: text("status", { enum: INITIATIVE_STATUSES })
    .notNull()
    .default("planned"),
  /** `numeric` arrives from the driver as a string. Read it through a parse. */
  confidence: numeric("confidence"),
  /** Null means nobody has judged it, which gate five reads differently. */
  capacity: text("capacity", { enum: CAPACITY_VERDICTS }),
  /** Derived from the initiative's own tasks at P5-T11. Never typed. */
  progressPct: numeric("progress_pct").notNull().default("0"),
  position: integer("position").notNull().default(0),
  legacyType: text("legacy_type"),
  legacyId: text("legacy_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const initiativeKeyResults = pgTable("initiative_key_results", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  initiativeId: uuid("initiative_id")
    .notNull()
    .references(() => initiatives.id, { onDelete: "cascade" }),
  keyResultId: uuid("key_result_id")
    .notNull()
    .references(() => keyResults.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Initiative = typeof initiatives.$inferSelect;
export type InitiativeKeyResult = typeof initiativeKeyResults.$inferSelect;
