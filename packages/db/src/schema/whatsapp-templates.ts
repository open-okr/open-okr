import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaces } from "./workspaces.ts";

/**
 * The approved templates one workspace has at Meta (P5-T04b-a).
 *
 * Migration 0060 holds the policy and the reasoning: these are synchronised from
 * Meta rather than declared here, because a template is registered inside one
 * customer's own Business account and no document in this repository could name
 * them for everybody.
 */
export const whatsappTemplates = pgTable(
  "whatsapp_templates",
  {
    id: uuid("id").primaryKey().$defaultFn(newId),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    metaId: text("meta_id").notNull(),
    name: text("name").notNull(),
    language: text("language").notNull(),
    /** Meta's own word: APPROVED, PENDING, REJECTED, PAUSED, DISABLED. */
    status: text("status").notNull(),
    category: text("category"),
    bodyText: text("body_text"),
    /** How many `{{n}}` placeholders the body has, counted at sync time. */
    variables: integer("variables").notNull().default(0),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("whatsapp_templates_name_idx").on(table.workspaceId, table.name),
  ],
);

export type WhatsAppTemplate = typeof whatsappTemplates.$inferSelect;
