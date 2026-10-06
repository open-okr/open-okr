import { date, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

/**
 * A member's leave, with a delegate (METHOD.md §7.4, P9-T19b-b).
 *
 * Both days included. While it runs nobody nudges the member, the check-ins
 * on goals they champion and the reviews they would receive go to the
 * delegate, and the roles stay theirs: leave never moves one for good.
 */
export const memberLeave = pgTable("member_leave", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  delegateMemberId: uuid("delegate_member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
