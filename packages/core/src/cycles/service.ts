/**
 * Cycle and rhythm writes, as helpers an Operation's `execute` calls
 * (TECHNICAL-PLAN §4.3, METHOD.md §2.1, P3-T02).
 *
 * Two callers share them, the way the space helpers are shared: the cycle
 * actions, and workspace provisioning, which gives a fresh workspace its rhythm
 * settings and its first cycle in the same transaction as the workspace itself.
 * A member who registers lands in a workspace that is already inside a cycle,
 * because a planning tool with no time box to plan in is not usable.
 */
import {
  activeOnly,
  type CycleCadence,
  cycles,
  newId,
  type RhythmSettingsRow,
  rhythmSettings,
  type WorkspaceTx,
  workspaces,
} from "@openokr/db";
import { and, desc, eq } from "drizzle-orm";
import { OperationError } from "../operations/operation.ts";
import {
  type CyclePeriod,
  cyclePeriodFor,
  localDateIn,
  statusForDate,
} from "./generation.ts";

type AnyTx<TSchema extends Record<string, unknown> = Record<string, never>> =
  WorkspaceTx<TSchema>;

/**
 * The cadence a new cycle inherits.
 *
 * The most recent cycle's own, falling back to quarterly. Deliberately not a
 * setting: §11 holds no cadence parameter and §4.14 holds no cycle settings, so
 * adding one would put the same fact in two places. The cadence a workspace
 * practises is the cadence its cycles have.
 */
const FALLBACK_CADENCE: CycleCadence = "quarterly";

/**
 * The workspace timezone, which every cycle bound and every countdown is read
 * in. UTC when unset, because a workspace that never chose one still has cycles.
 *
 * Shared rather than repeated: the cycle actions and the workflow actions both
 * answer date questions, and two copies of "which timezone is this workspace in"
 * is one copy too many.
 */
export async function workspaceTimeZone<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<string> {
  const [row] = await tx
    .select({ settings: workspaces.settings })
    // openokr:allow-raw-read: reads one setting off the workspace row inside an
    // Operation that has already authorised the acting member. The getter does
    // not return settings, and every cycle date is meaningless without this one.
    .from(workspaces)
    .where(activeOnly(workspaces, eq(workspaces.id, workspaceId)))
    .limit(1);
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  const timezone = settings.timezone;
  return typeof timezone === "string" && timezone !== "" ? timezone : "UTC";
}

export async function resolveWorkspaceCadence<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<CycleCadence> {
  const [latest] = await tx
    .select({ cadence: cycles.cadence })
    .from(cycles)
    .where(activeOnly(cycles, eq(cycles.workspaceId, workspaceId)))
    .orderBy(desc(cycles.startsOn))
    .limit(1);
  return latest?.cadence ?? FALLBACK_CADENCE;
}

export interface EnsureCycleInput {
  readonly workspaceId: string;
  /** The workspace timezone. Every cycle bound is a date read in it. */
  readonly timeZone: string;
  /** The clock, passed in so this stays testable and the engine stays pure. */
  readonly now: Date;
  /** Defaults to the most recent cycle's cadence, then to quarterly. */
  readonly cadence?: CycleCadence;
}

export interface EnsuredCycle {
  readonly id: string;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly status: string;
  readonly cadence: CycleCadence;
  /** False when the cycle already existed, so a caller can skip its audit row. */
  readonly created: boolean;
}

/**
 * The cycle containing today, created if it is missing.
 *
 * Idempotent: the unique index on `(workspace_id, mode, starts_on)` is what makes
 * that true under two concurrent callers rather than only under one, and a losing
 * insert falls back to reading the winner.
 */
export async function ensureCurrentCycleInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: EnsureCycleInput): Promise<EnsuredCycle> {
  const cadence =
    input.cadence ?? (await resolveWorkspaceCadence(tx, input.workspaceId));
  const today = localDateIn(input.now, input.timeZone);
  const period = cyclePeriodFor(cadence, today);

  const existing = await findCycleByPeriod(tx, input.workspaceId, period);
  if (existing) {
    return { ...existing, created: false };
  }

  // openokr:allow-mutation: this helper runs on the transaction the calling
  // Operation opened, so the cycle and that Operation's audit row commit
  // together or not at all.
  const [inserted] = await tx
    .insert(cycles)
    .values({
      id: newId(),
      workspaceId: input.workspaceId,
      name: period.name,
      mode: period.mode,
      cadence: period.cadence,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      // Never `active` on creation: a cycle becomes active when it is published
      // (METHOD.md §2.3 phase 5), not when its first day arrives.
      status: statusForDate(period, today, false),
      // Phase 1, Prepare. Phase 0 is annual-only and a quarterly cycle skips it.
      phase: period.mode === "annual" ? 0 : 1,
    })
    .returning({
      id: cycles.id,
      name: cycles.name,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
      status: cycles.status,
      cadence: cycles.cadence,
    });

  if (!inserted) {
    // Lost the race to a concurrent caller. The winner's row is the answer.
    const winner = await findCycleByPeriod(tx, input.workspaceId, period);
    if (!winner) {
      throw new Error("The cycle insert returned no row and none exists.");
    }
    return { ...winner, created: false };
  }

  return { ...inserted, created: true };
}

async function findCycleByPeriod<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  period: CyclePeriod,
): Promise<Omit<EnsuredCycle, "created"> | undefined> {
  const [row] = await tx
    .select({
      id: cycles.id,
      name: cycles.name,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
      status: cycles.status,
      cadence: cycles.cadence,
    })
    .from(cycles)
    .where(
      activeOnly(
        cycles,
        eq(cycles.workspaceId, workspaceId),
        eq(cycles.mode, period.mode),
        eq(cycles.startsOn, period.startsOn),
      ),
    )
    .limit(1);
  return row;
}

/**
 * The workspace's rhythm settings row, created if it is missing.
 *
 * Every column has a database default matching the canon, so the insert names no
 * values: the canon defaults are the row.
 */
export async function ensureRhythmSettingsInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<void> {
  const [existing] = await tx
    .select({ workspaceId: rhythmSettings.workspaceId })
    .from(rhythmSettings)
    .where(eq(rhythmSettings.workspaceId, workspaceId))
    .limit(1);
  if (existing) {
    return;
  }
  // openokr:allow-mutation: the calling Operation's own transaction, same reason
  // as ensureCurrentCycleInTx above.
  await tx.insert(rhythmSettings).values({ workspaceId });
}

/** The stored row, or null when a workspace predates the backfill. */
export async function readRhythmRow<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, workspaceId: string): Promise<RhythmSettingsRow | null> {
  const [row] = await tx
    .select()
    .from(rhythmSettings)
    .where(eq(rhythmSettings.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export interface CreateCycleInput {
  readonly workspaceId: string;
  readonly cadence: CycleCadence;
  /** The period to create, as local dates. Usually from `cyclePeriodFor`. */
  readonly period: CyclePeriod;
  readonly today: string;
  readonly firstCycle?: boolean;
  readonly sponsorId?: string | null;
  readonly facilitatorId?: string | null;
  readonly publicationDeadline?: string | null;
  readonly frameId?: string | null;
  readonly previousCycleId?: string | null;
}

/** Creates one named period. Refuses a duplicate rather than silently reusing it. */
export async function createCycleInTx<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(tx: AnyTx<TSchema>, input: CreateCycleInput): Promise<EnsuredCycle> {
  const existing = await findCycleByPeriod(tx, input.workspaceId, input.period);
  if (existing) {
    throw new OperationError(
      "forbidden",
      `${input.period.name} already exists in this workspace.`,
    );
  }

  // METHOD.md §4.5 gate 6: a publication deadline falls before day one of the
  // cycle. Checked here so a deadline that could never be met is refused at the
  // point somebody sets it, rather than only when the gate is evaluated.
  if (
    input.publicationDeadline &&
    input.publicationDeadline >= input.period.startsOn
  ) {
    throw new OperationError(
      "forbidden",
      "The publication deadline falls on or after the cycle starts. Publish before day one.",
    );
  }

  // openokr:allow-mutation: the calling Operation's own transaction.
  const [inserted] = await tx
    .insert(cycles)
    .values({
      id: newId(),
      workspaceId: input.workspaceId,
      name: input.period.name,
      mode: input.period.mode,
      cadence: input.cadence,
      startsOn: input.period.startsOn,
      endsOn: input.period.endsOn,
      status: "planning",
      phase: input.period.mode === "annual" ? 0 : 1,
      firstCycle: input.firstCycle ?? false,
      sponsorId: input.sponsorId ?? null,
      facilitatorId: input.facilitatorId ?? null,
      publicationDeadline: input.publicationDeadline ?? null,
      frameId: input.frameId ?? null,
      previousCycleId: input.previousCycleId ?? null,
    })
    .returning({
      id: cycles.id,
      name: cycles.name,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
      status: cycles.status,
      cadence: cycles.cadence,
    });

  if (!inserted) {
    throw new Error("The cycle insert returned no row.");
  }
  return { ...inserted, created: true };
}

/**
 * The cycle a surface should show: the one containing today, else the soonest
 * that has not started, else the most recent that has ended.
 *
 * Three answers rather than one because a workspace is legitimately in all three
 * states at different moments. Mid-planning it has a cycle that has not begun,
 * and showing nothing would hide the thing it is working on; just after a close
 * it has only finished cycles, and the newest of those is what a scorecard reads.
 *
 * Chosen in memory over one ordered read rather than in three queries: a
 * workspace has tens of cycles, not thousands, and the ordering rule reads as one
 * sentence here instead of three `where` clauses.
 */
export async function findCurrentCycle<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  tx: AnyTx<TSchema>,
  workspaceId: string,
  today: string,
  mode: "annual" | "quarterly" = "quarterly",
): Promise<Omit<EnsuredCycle, "created"> | undefined> {
  const rows = await tx
    .select({
      id: cycles.id,
      name: cycles.name,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
      status: cycles.status,
      cadence: cycles.cadence,
    })
    .from(cycles)
    .where(
      and(
        activeOnly(cycles, eq(cycles.workspaceId, workspaceId)),
        eq(cycles.mode, mode),
      ),
    )
    .orderBy(desc(cycles.startsOn));

  const containing = rows.find(
    (row) => row.startsOn <= today && row.endsOn >= today,
  );
  if (containing) {
    return containing;
  }
  // `rows` is newest first, so the soonest future cycle is the last future one.
  const future = rows.filter((row) => row.startsOn > today);
  return future.at(-1) ?? rows[0];
}
