/**
 * What a cycle has booked, read for phase 6 and CY-8, and for the booking
 * action that fills the gaps (METHOD.md §7.1, §2.3; completeness review H-08).
 *
 * `packages/method` decides what "booked for the whole cycle" means; this
 * module reads the rows it decides on, as local dates in the workspace
 * timezone, and names which space is short. Like `cycles/workflow.ts`, it has
 * no opinions of its own.
 */
import {
  activeOnly,
  decisions,
  goals,
  okrSessions as sessions,
  spaces,
  type WorkspaceTx,
} from "@openokr/db";
import {
  type BookedRitual,
  type CadenceWindow,
  cadenceCoverage,
} from "@openokr/method";
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";
import { spaceHolidaysInTx } from "../cadence/holidays.ts";
import { ritualFrequencyOf } from "../cadence/space-frequency.ts";
import { localDateIn } from "../cycles/generation.ts";
import { resolveRhythm } from "../cycles/rhythm.ts";
import { readRhythmRow } from "../cycles/service.ts";
import { practiceFromRow } from "../practice/settings.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

const RITUAL_KINDS = ["weekly", "monthly", "quarterly"] as const;

/** A local `YYYY-MM-DD` for an instant in a zone. */
export function localDateOf(instant: Date, timeZone: string): string {
  const { year, month, day } = localDateIn(instant, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface CycleBounds extends CadenceWindow {
  readonly id: string;
  /** An annual cycle owes its closing review and nothing else (P9-T20b-b). */
  readonly mode?: "annual" | "quarterly";
}

/**
 * The rituals each space has booked for a cycle, keyed by space.
 *
 * A session counts when it names the cycle, or when it names none and falls
 * inside it: sessions booked before this action existed carry no cycle. The
 * query reaches a day either side of the window and a week past its end,
 * because the quarterly review may land the week after close, and the local
 * date is what decides.
 */
export async function bookedRitualsBySpace<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycle: CycleBounds,
  timeZone: string,
  spaceIds?: readonly string[],
): Promise<Map<string, BookedRitual[]>> {
  const earliest = new Date(`${cycle.startsOn}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 1);
  const latest = new Date(`${cycle.endsOn}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() + 9);

  const rows = await tx
    .select({
      spaceId: sessions.spaceId,
      kind: sessions.kind,
      scheduledFor: sessions.scheduledFor,
      reviewPart: sessions.reviewPart,
    })
    .from(sessions)
    .where(
      activeOnly(
        sessions,
        eq(sessions.workspaceId, workspaceId),
        isNotNull(sessions.spaceId),
        inArray(sessions.kind, [...RITUAL_KINDS]),
        or(
          eq(sessions.cycleId, cycle.id),
          and(
            isNull(sessions.cycleId),
            gte(sessions.scheduledFor, earliest),
            lte(sessions.scheduledFor, latest),
          ),
        ),
        ...(spaceIds ? [inArray(sessions.spaceId, [...spaceIds])] : []),
      ),
    );

  const bySpace = new Map<string, BookedRitual[]>();
  for (const row of rows) {
    const spaceId = row.spaceId as string;
    const list = bySpace.get(spaceId) ?? [];
    list.push({
      kind: row.kind as BookedRitual["kind"],
      on: localDateOf(row.scheduledFor, timeZone),
      ...(row.reviewPart ? { part: row.reviewPart } : {}),
    });
    bySpace.set(spaceId, list);
  }
  return bySpace;
}

export interface CycleCadence {
  readonly bookedForWholeCycle: boolean;
  readonly decisionCount: number;
  /** Each short space's gaps, prefixed with its name. Empty when booked. */
  readonly gaps: readonly string[];
}

/**
 * Whether the cycle's rhythm is booked, and how many decisions it has.
 *
 * **Which spaces must be booked.** Every space that owns a goal in the cycle,
 * because those are the rooms whose goals the rituals review. A cycle whose
 * goals all sit at company level has no such space, and then any space that
 * has booked for the cycle is what is checked: a company runs its rhythm
 * somewhere. A cycle with neither has booked nothing.
 */
export async function loadCycleCadence<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  cycle: CycleBounds,
  timeZone: string,
): Promise<CycleCadence> {
  const owning = await tx
    .selectDistinct({ id: goals.spaceId, name: spaces.name })
    .from(goals)
    .innerJoin(spaces, eq(spaces.id, goals.spaceId))
    .where(
      activeOnly(
        goals,
        eq(goals.workspaceId, workspaceId),
        eq(goals.cycleId, cycle.id),
        isNotNull(goals.spaceId),
        isNull(spaces.deletedAt),
      ),
    );

  const booked = await bookedRitualsBySpace(tx, workspaceId, cycle, timeZone);

  let required = owning.map((row) => ({
    id: row.id as string,
    name: row.name,
  }));
  if (required.length === 0 && booked.size > 0) {
    const named = await tx
      .select({ id: spaces.id, name: spaces.name })
      // openokr:allow-raw-read: names only, for spaces this cycle's own
      // session rows already reference, inside the caller's authorised read.
      .from(spaces)
      .where(
        activeOnly(
          spaces,
          eq(spaces.workspaceId, workspaceId),
          inArray(spaces.id, [...booked.keys()]),
        ),
      );
    required = named;
  }

  const [decided] = await tx
    .select({ total: count() })
    .from(decisions)
    .where(
      activeOnly(
        decisions,
        eq(decisions.workspaceId, workspaceId),
        eq(decisions.cycleId, cycle.id),
      ),
    );
  const decisionCount = Number(decided?.total ?? 0);

  if (required.length === 0) {
    return {
      bookedForWholeCycle: false,
      decisionCount,
      gaps: ["No session is booked for this cycle"],
    };
  }

  // Each space judged at its own frequency (P9-T19a-d-b): a team on every
  // two weeks is short of nothing in the week between.
  const rhythmRow = await readRhythmRow(tx, workspaceId);
  const { thresholds } = resolveRhythm(rhythmRow);
  // Held apart, the retrospective is owed as well (§8, P9-T20b-a).
  const reviewFormat =
    practiceFromRow(rhythmRow).practice["review.format"] === "split"
      ? ("split" as const)
      : ("oneSession" as const);
  const gaps: string[] = [];
  for (const space of required.sort((a, b) => a.name.localeCompare(b.name))) {
    const frequency = await ritualFrequencyOf(
      tx,
      workspaceId,
      space.id,
      thresholds,
    );
    gaps.push(
      ...cadenceCoverage(cycle, booked.get(space.id) ?? [], {
        frequency,
        holidays: await spaceHolidaysInTx(tx, workspaceId, space.id),
        reviewLeadWeeks: thresholds["cadence.reviewPreparationLeadWeeks"],
        reviewFormat,
        cycleMode: cycle.mode ?? "quarterly",
      }).missing.map((line) => `${space.name}: ${line}`),
    );
  }
  return { bookedForWholeCycle: gaps.length === 0, decisionCount, gaps };
}
