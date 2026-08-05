import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** Drizzle view of the fixture table in `migrations/0001_tenant_probes.sql`. */
export const tenantProbes = pgTable("tenant_probes", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
