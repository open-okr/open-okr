/**
 * Session digests (TECHNICAL-PLAN §4, METHOD.md §7.2 step 4, P4-T08).
 *
 * Generated from the session record, editable (coordinator note), then
 * published to channels. The body is a JSON object with named fields
 * derived from session data.
 */
import {
  date,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

export const DIGEST_SCOPES = ["space", "workspace", "member"] as const;
export type DigestScope = (typeof DIGEST_SCOPES)[number];

export const DIGEST_PERIODS = ["daily", "weekly", "cycle"] as const;
export type DigestPeriod = (typeof DIGEST_PERIODS)[number];

export interface DigestBody {
  readonly averageConfidence?: number;
  readonly confidenceChange?: number;
  readonly onTrackCount?: number;
  readonly atRiskCount?: number;
  readonly blockerCount?: number;
  readonly commitmentCount?: number;
  readonly atRiskKrs?: readonly {
    id: string;
    title: string;
    confidence: number;
  }[];
}

export const digests = pgTable("digests", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  scope: text("scope", { enum: DIGEST_SCOPES }).notNull(),
  scopeId: uuid("scope_id"),
  period: text("period", { enum: DIGEST_PERIODS }).notNull(),
  periodStart: date("period_start").notNull(),
  body: jsonb("body").$type<DigestBody>().notNull().default({}),
  note: text("note"),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  channels: text("channels").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Digest = typeof digests.$inferSelect;
