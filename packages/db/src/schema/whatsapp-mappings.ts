import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { whatsappTemplates } from "./whatsapp-templates.ts";
import { workspaces } from "./workspaces.ts";

/**
 * Which template a nudge uses, and what fills its variables (P5-T04b-b).
 *
 * Migration 0061 holds the policy and the reasoning. `bindings` is an ordered
 * list whose position is the placeholder number: the first fills `{{1}}`.
 */
export const whatsappTemplateMappings = pgTable("whatsapp_template_mappings", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  ruleKey: text("rule_key").notNull(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => whatsappTemplates.id, { onDelete: "cascade" }),
  /** One source name per placeholder, in placeholder order. */
  bindings: jsonb("bindings").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type WhatsAppTemplateMapping =
  typeof whatsappTemplateMappings.$inferSelect;
