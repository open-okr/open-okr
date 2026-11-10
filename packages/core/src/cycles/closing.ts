/**
 * Moving a cycle to `closing` (docs/design/okr-core-domain.md §10, plan 0.7.0
 * O2, approved by Akmal on 9 November 2026, Q1 yes).
 *
 * `closing` was a status the schema, the action output and the `cycle.closing`
 * nudge all expected and nothing produced. Two things produce it now:
 *
 * - **The date** (C1 to C3): an hourly sweep moves every `planning` or
 *   `active` cycle whose end has passed in the workspace's own timezone, by
 *   asking `statusForDate`, which already holds the rule.
 * - **The facilitator** (C4, C5), through `cycles.setClosing`, who may start it
 *   early and undo that while the end has not passed.
 *
 * Entering `closing` moves the phase pointer to 7, where the close control is.
 * Nothing closes a cycle but a person behind phase 7.
 */
import { activeOnly, cycles, withWorkspace } from "@openokr/db";
import { eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { runOperation } from "../operations/operation.ts";
import {
  formatLocalDate,
  localDateIn,
  parseLocalDate,
  statusForDate,
} from "./generation.ts";
import { workspaceTimeZone } from "./service.ts";

/** Thrown inside the Operation when the cycle is no longer due. */
class NotDue extends Error {}

/** The phase a closing cycle points at: Review and learn (§3.2, C5). */
export const CLOSING_PHASE = 7;

/**
 * Moves every ended cycle of one workspace to `closing` (C1). One Operation
 * per cycle moved, as the `system` principal, with the row locked and the date
 * checked again inside it; a workspace with nothing due writes nothing (C3).
 * Returns how many moved.
 */
export async function sweepEndedCycles(
  pool: Pool,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const { today, due } = await withWorkspace(
    drizzle(pool),
    workspaceId,
    async (tx) => {
      const local = formatLocalDate(
        localDateIn(now, await workspaceTimeZone(tx, workspaceId)),
      );
      const rows = await tx
        .select({ id: cycles.id })
        .from(cycles)
        .where(
          activeOnly(
            cycles,
            eq(cycles.workspaceId, workspaceId),
            inArray(cycles.status, ["planning", "active"]),
            lt(cycles.endsOn, local),
          ),
        );
      return { today: local, due: rows.map((row) => row.id) };
    },
  );

  let moved = 0;
  for (const cycleId of due) {
    try {
      await runOperation(
        { pool },
        {
          action: "cycles.sweepEnded",
          workspaceId,
          // A date passing is a fact, not a proposal (C2): neither an agent
          // run nor a registry action.
          actor: { kind: "system" },
          async execute({ tx }) {
            const [cycle] = await tx
              .select({
                name: cycles.name,
                startsOn: cycles.startsOn,
                endsOn: cycles.endsOn,
                status: cycles.status,
                publishedAt: cycles.publishedAt,
              })
              .from(cycles)
              .where(activeOnly(cycles, eq(cycles.id, cycleId)))
              .for("update")
              .limit(1);
            if (
              !cycle ||
              (cycle.status !== "planning" && cycle.status !== "active") ||
              statusForDate(
                cycle,
                parseLocalDate(today),
                cycle.publishedAt !== null,
              ) !== "closing"
            ) {
              throw new NotDue();
            }
            // openokr:allow-mutation: this Operation's own transaction.
            await tx
              .update(cycles)
              .set({
                status: "closing",
                phase: CLOSING_PHASE,
                updatedAt: now,
              })
              .where(activeOnly(cycles, eq(cycles.id, cycleId)));
            return {
              result: undefined,
              activity: {
                kind: "cycle.closing_started",
                subjectType: "cycle",
                subjectId: cycleId,
                payload: { cycleId, name: cycle.name, by: "date" },
              },
              audit: {
                action: "cycles.sweepEnded",
                targetType: "cycle",
                targetId: cycleId,
                payload: { from: cycle.status, endsOn: cycle.endsOn },
              },
            };
          },
        },
      );
      moved += 1;
    } catch (error) {
      if (!(error instanceof NotDue)) {
        throw error;
      }
    }
  }
  return moved;
}
