/**
 * Session participants and the room pulse (TECHNICAL-PLAN §4.7, METHOD.md
 * §8.2, P4-T10a-b).
 *
 * One row per person per session, created when they take part rather than when
 * the session is made: a pulse averaged over people who never arrived is not
 * the room's pulse.
 */
import {
  boolean,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { newId } from "../id.ts";
import { sessions } from "./sessions.ts";
import { workspaceMembers, workspaces } from "./workspaces.ts";

export const sessionParticipants = pgTable("session_participants", {
  id: uuid("id").primaryKey().$defaultFn(newId),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => workspaceMembers.id, { onDelete: "cascade" }),
  attended: boolean("attended").notNull().default(true),
  /**
   * §8.2's one-to-five pulse. Null until the person gives it, because a missing
   * pulse and a pulse of one are different facts and the read of the room has
   * to tell them apart.
   */
  pulse: smallint("pulse"),
  /** §8.2's one word for the cycle. One, not a sentence. */
  word: text("word"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type SessionParticipant = typeof sessionParticipants.$inferSelect;
