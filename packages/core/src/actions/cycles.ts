/**
 * Cycle, annual frame and rhythm actions (TECHNICAL-PLAN §4.3, METHOD.md §2.1,
 * §11, P3-T02).
 *
 * The annual frame is read-only reference material during a quarterly cycle
 * (METHOD.md §2.1: "Phase 3 of a quarterly cycle revalidates it. It does not
 * rewrite it"), so `frame.update` refuses while a quarterly cycle is the one
 * being run, and superseding rather than editing is how a new year begins.
 */

import {
  activeOnly,
  annualFrameRevisions,
  annualFrames,
  annualStrategies,
  CYCLE_CADENCES,
  cycles,
  FRAME_FIELDS,
  type FrameField,
  GOAL_LEVELS,
  goals,
  performanceSnapshots,
  rhythmSettings,
  scorecardSettings,
  withContext,
  workspaceMembers,
} from "@openokr/db";
import { LOCAL_DATE_PATTERN } from "@openokr/formats";
import {
  CHECK_IN_FREQUENCIES,
  COACH_STRICTNESS,
  scoreBand,
  scoreBandsIn,
  THRESHOLD_KEYS,
  THRESHOLDS,
} from "@openokr/method";
import { asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { getAccessScoped } from "../access/reads.ts";
import {
  archiveCycleInTx,
  closeCycleInTx,
  feedForwardInTx,
  feedFromClosedPredecessorInTx,
} from "../cycles/archive.ts";
import {
  addDays,
  cyclePeriodFor,
  formatLocalDate,
  localDateIn,
  parseLocalDate,
} from "../cycles/generation.ts";
import { cycleMovesInTx } from "../cycles/moved.ts";
import {
  COLUMN_BACKED_THRESHOLDS,
  mergeOverrides,
  resolveRhythm,
  validateRhythmPatch,
} from "../cycles/rhythm.ts";
import { cycleRulesInTx } from "../cycles/rules.ts";
import {
  createCycleInTx,
  ensureCurrentCycleInTx,
  ensureRhythmSettingsInTx,
  findCurrentCycle,
  readRhythmRow,
  resolveWorkspaceCadence,
  workspaceTimeZone,
} from "../cycles/service.ts";
import { assertLegacyKeyFree, legacyKey } from "../imports/legacy.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { cycleLevelsInTx } from "../practice/levels.ts";
import { RICH_TEXT_SCHEMA_VERSION } from "../rich-text/schema.ts";
import { isValidRichText } from "../rich-text/validate.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const cycleOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  mode: z.enum(["annual", "quarterly"]),
  cadence: z.enum(CYCLE_CADENCES),
  startsOn: z.string(),
  endsOn: z.string(),
  status: z.enum(["planning", "active", "closing", "closed"]),
  phase: z.number().int().min(0).max(7),
  levels: z.array(z.enum(GOAL_LEVELS)),
  firstCycle: z.boolean(),
  publicationDeadline: z.string().nullable(),
  sponsorId: z.uuid().nullable(),
  facilitatorId: z.uuid().nullable(),
});

export type CycleOutput = z.infer<typeof cycleOutput>;

/** Resolves the acting member, or refuses the way every other read does. */
async function actingMember(
  tx: OperationTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError("not_found", "No such workspace.");
  }
  return member.id;
}

/**
 * A sponsor or facilitator a cycle may name: an active person in this
 * workspace (completeness review H-09). The foreign key alone accepts a
 * suspended member, an agent, or a member of another workspace, because a key
 * check does not see row-level security.
 */
async function requireCycleRole(
  tx: OperationTx,
  workspaceId: string,
  memberId: string,
  role: "sponsor" | "facilitator",
): Promise<void> {
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.id, memberId),
        eq(workspaceMembers.status, "active"),
        inArray(workspaceMembers.kind, ["human", "guest"]),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError(
      "forbidden",
      `The ${role} must be an active person in this workspace.`,
    );
  }
}

const toCycleOutput = (row: {
  id: string;
  name: string;
  mode: "annual" | "quarterly";
  cadence: (typeof CYCLE_CADENCES)[number];
  startsOn: string;
  endsOn: string;
  status: "planning" | "active" | "closing" | "closed";
  phase: number;
  levels: unknown;
  firstCycle: boolean;
  publicationDeadline: string | null;
  sponsorId: string | null;
  facilitatorId: string | null;
}): CycleOutput => ({
  id: row.id,
  name: row.name,
  mode: row.mode,
  cadence: row.cadence,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  status: row.status,
  phase: row.phase,
  levels: (Array.isArray(row.levels)
    ? row.levels
    : []) as CycleOutput["levels"],
  firstCycle: row.firstCycle,
  publicationDeadline: row.publicationDeadline,
  sponsorId: row.sponsorId,
  facilitatorId: row.facilitatorId,
});

const CYCLE_COLUMNS = {
  id: cycles.id,
  name: cycles.name,
  mode: cycles.mode,
  cadence: cycles.cadence,
  startsOn: cycles.startsOn,
  endsOn: cycles.endsOn,
  status: cycles.status,
  phase: cycles.phase,
  levels: cycles.levels,
  firstCycle: cycles.firstCycle,
  publicationDeadline: cycles.publicationDeadline,
  sponsorId: cycles.sponsorId,
  facilitatorId: cycles.facilitatorId,
} as const;

/**
 * The rules one cycle is read under (METHOD.md §12, P9-T14b): the
 * workspace's settings while it is open, the ones it closed with after, and
 * today's canon for a cycle closed before snapshots existed. Every view of a
 * closed cycle's verdicts reads this rather than the settings as they stand.
 */
export const readCycleRules = defineReadAction({
  name: "cycles.rules",
  summary:
    "The practice settings and thresholds a cycle is read under: today's while it is open, the ones it closed with after.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    source: z.enum(["live", "snapshot", "canon"]),
    thresholds: z.record(z.string(), z.unknown()),
    practice: z.record(z.string(), z.unknown()),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        // A cycle is read through the workspace, as `cycles.list` explains.
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });
        const rules = await cycleRulesInTx(
          tx as OperationTx,
          context.workspaceId,
          input.cycleId,
        );
        return {
          source: rules.source,
          thresholds: { ...rules.thresholds },
          practice: { ...rules.practice },
        };
      },
    );
  },
});

/**
 * The OKR levels one cycle offers (P9-T07a-c, METHOD v2 §2.7): the levels it
 * began with, plus any level its objectives already use. What every level
 * picker and the level filter read, so a cycle never offers a level the
 * policy would refuse, and never hides one an objective in it already has.
 */
export const readCycleLevels = defineReadAction({
  name: "cycles.levelsInUse",
  summary:
    "The OKR levels one cycle offers: the levels it began with, plus any its objectives already use.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({ levels: z.array(z.enum(GOAL_LEVELS)) }),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        // A cycle is read through the workspace, as `cycles.list` explains.
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });
        return {
          levels: await cycleLevelsInTx(
            tx as OperationTx,
            context.workspaceId,
            input.cycleId,
          ),
        };
      },
    );
  },
});

export const listCycles = defineReadAction({
  name: "cycles.list",
  summary: "Every cycle this workspace has, newest first.",
  input: z.object({}),
  output: z.array(cycleOutput),
  access: ACCESS_LEVELS.view,
  async handler(context): Promise<CycleOutput[]> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        // A cycle belongs to the workspace, so the workspace's own context is
        // what authorises reading its list. Cycles hold no context of their own:
        // TECHNICAL-PLAN §4.1 lists the protected aggregates and a cycle is one
        // of them, but the visibility question a cycle actually poses is "may
        // you see this workspace", and per-cycle bindings would answer a question
        // nobody asks.
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const rows = await tx
          .select(CYCLE_COLUMNS)
          .from(cycles)
          .where(
            activeOnly(cycles, eq(cycles.workspaceId, context.workspaceId)),
          )
          .orderBy(desc(cycles.startsOn));
        return rows.map(toCycleOutput);
      },
    );
  },
});

export const readCurrentCycle = defineReadAction({
  name: "cycles.current",
  summary:
    "The cycle to show: the one containing today, else the soonest ahead, else the most recent behind.",
  input: z.object({
    mode: z.enum(["annual", "quarterly"]).default("quarterly"),
  }),
  output: cycleOutput.nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input): Promise<CycleOutput | null> {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const timeZone = await workspaceTimeZone(
          tx as OperationTx,
          context.workspaceId,
        );
        const today = formatLocalDate(localDateIn(new Date(), timeZone));
        const found = await findCurrentCycle(
          tx as OperationTx,
          context.workspaceId,
          today,
          input.mode,
        );
        if (!found) {
          return null;
        }
        const [row] = await tx
          .select(CYCLE_COLUMNS)
          .from(cycles)
          .where(activeOnly(cycles, eq(cycles.id, found.id)))
          .limit(1);
        return row ? toCycleOutput(row) : null;
      },
    );
  },
});

export const ensureCurrentCycle = defineWriteAction({
  name: "cycles.ensureCurrent",
  summary:
    "Creates the cycle containing today if the workspace has none. Idempotent.",
  input: z.object({
    /**
     * Which cadence's period to ensure, defaulting to the workspace's own
     * (P6-G14b).
     *
     * **The default used to be the most recent cycle's cadence, and that
     * surprised a caller.** A workspace that opened an annual cycle for §2.1's
     * frame had an annual cycle as its most recent, so the next bare
     * `ensureCurrent` built the annual period containing today rather than the
     * quarter. The default now reads the quarterly-mode cycles first
     * (completeness review M-06), and phase 0's "send this into the quarter"
     * still names the quarter, because it wants one whatever the frame did.
     */
    cadence: z.enum(CYCLE_CADENCES).optional(),
  }),
  output: cycleOutput.extend({ created: z.boolean() }),
  // Any human member may bring the current cycle into being. Refusing an
  // ordinary member would mean a workspace whose admin is on holiday cannot
  // check in, and the row it creates is one every surface needs.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const timeZone = await workspaceTimeZone(tx, workspaceId);
      const ensured = await ensureCurrentCycleInTx(tx, {
        ...(input.cadence ? { cadence: input.cadence } : {}),
        workspaceId,
        timeZone,
        now: new Date(),
      });
      // §8.9's inheritance, when the cycle before this one closed with nowhere
      // to send it (M-05). Only on creation: a cycle that already existed was
      // either fed at that close or has nothing waiting for it.
      const inherited = ensured.created
        ? await feedFromClosedPredecessorInTx(tx, workspaceId, ensured.id)
        : null;
      const [row] = await tx
        .select(CYCLE_COLUMNS)
        .from(cycles)
        .where(activeOnly(cycles, eq(cycles.id, ensured.id)))
        .limit(1);
      if (!row) {
        throw new Error("The ensured cycle could not be read back.");
      }
      return {
        result: { ...toCycleOutput(row), created: ensured.created },
        activity: {
          kind: ensured.created ? "cycle.created" : "cycle.resolved",
          subjectType: "cycle",
          subjectId: ensured.id,
          payload: {
            name: ensured.name,
            ...(inherited ? { inheritedFrom: inherited.fromName } : {}),
          },
        },
        audit: {
          action: "cycles.ensureCurrent",
          targetType: "cycle",
          targetId: ensured.id,
          payload: {
            name: ensured.name,
            created: ensured.created,
            ...(inherited
              ? {
                  inheritedFrom: inherited.fromCycleId,
                  priorScores: inherited.result.priorScores,
                  issues: inherited.result.issues,
                  processPriority: inherited.result.processPriority,
                }
              : {}),
          },
        },
      };
    },
  }),
});

export const createCycle = defineWriteAction({
  name: "cycles.create",
  summary: "Creates a named cycle for the period containing a chosen date.",
  input: z.object({
    /** A date inside the period to create, not the period's own start. */
    on: z.string().regex(LOCAL_DATE_PATTERN),
    cadence: z.enum(CYCLE_CADENCES).optional(),
    /**
     * Which of METHOD.md §2.1's two horizons to create, when no cadence is
     * named (completeness review M-06).
     *
     * The cycle screen asks for a horizon, not a cadence: "the annual cycle
     * containing this date" or "the quarterly one". Annual has one cadence,
     * and the quarterly horizon takes whichever the workspace already
     * practises, so a workspace running half-years gets a half-year. A
     * cadence and a mode that disagree are refused rather than one of them
     * being quietly ignored.
     */
    mode: z.enum(["annual", "quarterly"]).optional(),
    firstCycle: z.boolean().default(false),
    sponsorId: z.uuid().nullable().optional(),
    facilitatorId: z.uuid().nullable().optional(),
    publicationDeadline: z
      .string()
      .regex(LOCAL_DATE_PATTERN)
      .nullable()
      .optional(),
    /**
     * The name to use instead of the period's own (P6-T03a).
     *
     * Set by the importer, which keeps the name the source used because that is
     * the one the people being migrated recognise. The period still decides the
     * dates and the mode, so nothing about the rhythm changes; only the label.
     */
    name: z.string().trim().min(1).max(120).optional(),
    /** The source system's identifier for this cycle, when an import made it. */
    legacy: legacyKey.optional(),
  }),
  output: cycleOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      await assertLegacyKeyFree(tx, workspaceId, cycles, input.legacy, "cycle");
      if (
        input.cadence &&
        input.mode &&
        (input.cadence === "annual") !== (input.mode === "annual")
      ) {
        throw new OperationError(
          "forbidden",
          `A ${input.cadence} cadence does not make a ${input.mode} cycle. Name one or the other.`,
        );
      }
      const cadence =
        input.cadence ??
        (await resolveWorkspaceCadence(tx, workspaceId, input.mode));
      const period = cyclePeriodFor(cadence, parseLocalDate(input.on));
      const timeZone = await workspaceTimeZone(tx, workspaceId);
      // **Three defaults, so a cycle can be made from a date alone**
      // (P8-G13d, TECHNICAL-PLAN §4.14). Agung's complaint had two halves:
      // the gates, which stay, and the number of answers a form demands
      // before it will accept anything. These are the second half.
      //
      // The sponsor and the facilitator default to whoever creates the
      // cycle. METHOD.md §2 phase 1 asks that both be *named*, and this names
      // them: somebody who makes a cycle on their own is both until they say
      // otherwise, and phase 1 reads green instead of listing two things the
      // person making it could only have answered with their own name. It is
      // a starting value, not a claim: the cycle screen reassigns either.
      //
      // The publication deadline defaults to the day before the cycle starts.
      // Publish gate 6 asks for a date strictly before day one and says
      // nothing about how far before, so the latest allowed date is the only
      // one the product can choose without inventing a judgement. A
      // facilitator pulls it earlier.
      const memberId = await actingMember(
        tx,
        workspaceId,
        _context.actor.userId,
      );
      const created = await createCycleInTx(tx, {
        workspaceId,
        cadence,
        period,
        today: formatLocalDate(localDateIn(new Date(), timeZone)),
        firstCycle: input.firstCycle,
        sponsorId: input.sponsorId ?? memberId,
        facilitatorId: input.facilitatorId ?? memberId,
        publicationDeadline:
          input.publicationDeadline ??
          formatLocalDate(addDays(parseLocalDate(period.startsOn), -1)),
        ...(input.name ? { name: input.name } : {}),
        ...(input.legacy ? { legacy: input.legacy } : {}),
      });
      // The same inheritance `cycles.ensureCurrent` hands on (M-05). Creating
      // next quarter after this one closed is the order §8.10 asks for, so it
      // is the usual way the feed-forward lands.
      const inherited = await feedFromClosedPredecessorInTx(
        tx,
        workspaceId,
        created.id,
      );
      const [row] = await tx
        .select(CYCLE_COLUMNS)
        .from(cycles)
        .where(activeOnly(cycles, eq(cycles.id, created.id)))
        .limit(1);
      if (!row) {
        throw new Error("The created cycle could not be read back.");
      }
      return {
        result: toCycleOutput(row),
        activity: {
          kind: "cycle.created",
          subjectType: "cycle",
          subjectId: created.id,
          payload: {
            name: created.name,
            ...(inherited ? { inheritedFrom: inherited.fromName } : {}),
          },
        },
        audit: {
          action: "cycles.create",
          targetType: "cycle",
          targetId: created.id,
          payload: {
            name: created.name,
            startsOn: created.startsOn,
            endsOn: created.endsOn,
            ...(inherited
              ? {
                  inheritedFrom: inherited.fromCycleId,
                  priorScores: inherited.result.priorScores,
                  issues: inherited.result.issues,
                  processPriority: inherited.result.processPriority,
                }
              : {}),
          },
        },
      };
    },
  }),
});

export const updateCycle = defineWriteAction({
  name: "cycles.update",
  summary:
    "Sets a cycle's roles, phase, levels, session dates or publication deadline.",
  input: z.object({
    id: z.uuid(),
    phase: z.number().int().min(0).max(7).optional(),
    sponsorId: z.uuid().nullable().optional(),
    facilitatorId: z.uuid().nullable().optional(),
    publicationDeadline: z
      .string()
      .regex(LOCAL_DATE_PATTERN)
      .nullable()
      .optional(),
    levels: z.array(z.enum(GOAL_LEVELS)).min(1).optional(),
    contributingUnits: z.string().max(2000).nullable().optional(),
    firstCycle: z.boolean().optional(),
    sessionDates: z
      .array(
        z.object({
          key: z.string().min(1).max(60),
          on: z.string().regex(LOCAL_DATE_PATTERN),
        }),
      )
      .max(20)
      .optional(),
  }),
  output: cycleOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      if (input.sponsorId) {
        await requireCycleRole(tx, workspaceId, input.sponsorId, "sponsor");
      }
      if (input.facilitatorId) {
        await requireCycleRole(
          tx,
          workspaceId,
          input.facilitatorId,
          "facilitator",
        );
      }
      const [existing] = await tx
        .select(CYCLE_COLUMNS)
        .from(cycles)
        .where(
          activeOnly(
            cycles,
            eq(cycles.id, input.id),
            eq(cycles.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new OperationError("not_found", "No such cycle.");
      }
      if (existing.status === "closed") {
        throw new OperationError(
          "forbidden",
          "This cycle is closed. Its record does not change after the archive.",
        );
      }
      if (
        input.publicationDeadline &&
        input.publicationDeadline >= existing.startsOn
      ) {
        throw new OperationError(
          "forbidden",
          "The publication deadline falls on or after the cycle starts. Publish before day one.",
        );
      }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of [
        "phase",
        "sponsorId",
        "facilitatorId",
        "publicationDeadline",
        "levels",
        "contributingUnits",
        "firstCycle",
        "sessionDates",
      ] as const) {
        if (input[key] !== undefined) {
          patch[key] = input[key];
        }
      }

      const [updated] = await tx
        .update(cycles)
        .set(patch)
        .where(activeOnly(cycles, eq(cycles.id, input.id)))
        .returning(CYCLE_COLUMNS);
      if (!updated) {
        throw new OperationError("not_found", "No such cycle.");
      }

      return {
        result: toCycleOutput(updated),
        activity: {
          kind: "cycle.updated",
          subjectType: "cycle",
          subjectId: updated.id,
          payload: { name: updated.name },
        },
        audit: {
          action: "cycles.update",
          targetType: "cycle",
          targetId: updated.id,
          payload: { name: updated.name, fields: Object.keys(patch) },
        },
      };
    },
  }),
});

export const archiveCycle = defineWriteAction({
  name: "cycles.archive",
  summary: "Archives a cycle. Its goals and scores stay readable.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const [archived] = await tx
        .update(cycles)
        .set({ deletedAt: new Date() })
        .where(
          activeOnly(
            cycles,
            eq(cycles.id, input.id),
            eq(cycles.workspaceId, workspaceId),
          ),
        )
        .returning({ id: cycles.id, name: cycles.name });
      if (!archived) {
        throw new OperationError("not_found", "No such cycle.");
      }
      return {
        result: { id: archived.id },
        activity: {
          kind: "cycle.archived",
          subjectType: "cycle",
          subjectId: archived.id,
          payload: { name: archived.name },
        },
        audit: {
          action: "cycles.archive",
          targetType: "cycle",
          targetId: archived.id,
          payload: { name: archived.name },
        },
      };
    },
  }),
});

// --- The rhythm registry ---------------------------------------------------

const thresholdDescriptor = z.object({
  key: z.string(),
  group: z.string(),
  label: z.string(),
  section: z.string(),
  why: z.string(),
  /** True when this parameter has its own column rather than living in the map. */
  columnBacked: z.boolean(),
});

export const readRhythmSettings = defineReadAction({
  name: "rhythm.read",
  summary:
    "The METHOD.md §11 registry as this workspace resolves it, with its deviations and its terminology.",
  input: z.object({}),
  output: z.object({
    defaultCheckInFrequency: z.enum(CHECK_IN_FREQUENCIES),
    checkInAnchorDay: z.number().int().min(1).max(7),
    coachStrictness: z.enum(COACH_STRICTNESS),
    /** Only the keys this workspace deviates on. */
    overrides: z.record(z.string(), z.unknown()),
    /** Every key, resolved: canon defaults with the deviations applied. */
    thresholds: z.record(z.string(), z.unknown()),
    terminology: z.record(z.string(), z.unknown()),
    registry: z.array(thresholdDescriptor),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        // View, not full: every member reads the thresholds their own goals are
        // judged against. Changing them needs `manage_coaching`, which is the
        // `full` on `rhythm.update` below.
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const row = await readRhythmRow(tx as OperationTx, context.workspaceId);
        const resolved = resolveRhythm(row);
        return {
          defaultCheckInFrequency: row?.defaultCheckInFrequency ?? "weekly",
          checkInAnchorDay: row?.checkInAnchorDay ?? 1,
          coachStrictness: row?.coachStrictness ?? "warn",
          overrides: (row?.overrides ?? {}) as Record<string, unknown>,
          thresholds: resolved.thresholds as unknown as Record<string, unknown>,
          terminology: resolved.terminology as unknown as Record<
            string,
            unknown
          >,
          registry: THRESHOLD_KEYS.map((key) => ({
            key,
            group: THRESHOLDS[key].group,
            label: THRESHOLDS[key].label,
            section: THRESHOLDS[key].section,
            why: THRESHOLDS[key].why,
            columnBacked: (
              COLUMN_BACKED_THRESHOLDS as readonly string[]
            ).includes(key),
          })),
        };
      },
    );
  },
});

export const updateRhythmSettings = defineWriteAction({
  name: "rhythm.update",
  summary:
    "Changes this workspace's deviations from the §11 canon, or its terminology.",
  input: z.object({
    defaultCheckInFrequency: z.enum(CHECK_IN_FREQUENCIES).optional(),
    checkInAnchorDay: z.number().int().min(1).max(7).optional(),
    coachStrictness: z.enum(COACH_STRICTNESS).optional(),
    /**
     * Holds every non-exempt §6.4 rule quiet (P6-G21).
     *
     * `rhythm_settings.quiet_mode` has existed since P4-T04b and the
     * suppression decision has read it since then; nothing could set it, so a
     * workspace being drowned by its own product had a switch with no handle.
     * Not a §11 threshold: it is an operational state a workspace turns on for
     * a fortnight, not a number the practice is judged by.
     */
    quietMode: z.boolean().optional(),
    /** Sparse. A key set to null returns that threshold to the canon default. */
    overrides: z.record(z.string(), z.unknown()).optional(),
    labels: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.object({
    overrides: z.record(z.string(), z.unknown()),
    thresholds: z.record(z.string(), z.unknown()),
    terminology: z.record(z.string(), z.unknown()),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const { patch, problems } = validateRhythmPatch(input);
      if (problems.length > 0) {
        throw new OperationError(
          "forbidden",
          problems
            .map((problem) =>
              problem.key
                ? `${problem.key}: ${problem.message}`
                : problem.message,
            )
            .join(" "),
        );
      }

      await ensureRhythmSettingsInTx(tx, workspaceId);
      const stored = await readRhythmRow(tx, workspaceId);

      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.defaultCheckInFrequency !== undefined) {
        values.defaultCheckInFrequency = patch.defaultCheckInFrequency;
      }
      if (patch.checkInAnchorDay !== undefined) {
        values.checkInAnchorDay = patch.checkInAnchorDay;
      }
      if (patch.coachStrictness !== undefined) {
        values.coachStrictness = patch.coachStrictness;
      }
      // Straight through rather than into the override map: it has a column.
      if (input.quietMode !== undefined) {
        values.quietMode = input.quietMode;
      }
      if (patch.overrides !== undefined) {
        values.overrides = mergeOverrides(
          (stored?.overrides ?? {}) as Record<string, unknown>,
          patch.overrides,
        );
      }
      if (patch.labels !== undefined) {
        values.labels = mergeOverrides(
          (stored?.labels ?? {}) as Record<string, unknown>,
          patch.labels,
        );
      }

      const [updated] = await tx
        .update(rhythmSettings)
        .set(values)
        .where(eq(rhythmSettings.workspaceId, workspaceId))
        .returning();
      if (!updated) {
        throw new Error("The rhythm settings row could not be updated.");
      }

      const resolved = resolveRhythm(updated);
      return {
        result: {
          overrides: updated.overrides as Record<string, unknown>,
          thresholds: resolved.thresholds as unknown as Record<string, unknown>,
          terminology: resolved.terminology as unknown as Record<
            string,
            unknown
          >,
        },
        activity: {
          kind: "rhythm.updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: {
            keys: Object.keys(values).filter((k) => k !== "updatedAt"),
          },
        },
        audit: {
          action: "rhythm.update",
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            keys: Object.keys(values).filter((key) => key !== "updatedAt"),
            overrides: updated.overrides,
          },
        },
      };
    },
  }),
});

// --- The annual frame -----------------------------------------------------

/**
 * Editor JSON for the current schema, or null (P6-G14).
 *
 * The frame's four prose fields are rich text with their own version columns,
 * the same shape a task description takes, because METHOD.md §2.1 expects a
 * mission somebody wrote in sentences rather than a single line.
 */
const frameProse = z
  .unknown()
  .refine(
    (value) =>
      value === null || isValidRichText(value, RICH_TEXT_SCHEMA_VERSION),
    { message: "not valid editor JSON for the current rich text schema" },
  );

const frameOutput = z.object({
  id: z.uuid(),
  yearLabel: z.string(),
  horizonLabel: z.string().nullable(),
  agreed: z.boolean(),
  /**
   * The prose §2.1 asks for, which migration 0020 has stored since P3-T02 and
   * nothing ever read or wrote (P6-G14).
   *
   * The columns were there, with their version columns beside them, and this
   * action returned four scalars and a list. So phase 0 had a table holding a
   * mission and no way to put one in it, which is what made B-03 a blocker
   * rather than a missing screen.
   */
  mission: z.unknown().nullable(),
  vision: z.unknown().nullable(),
  strategy: z.unknown().nullable(),
  notDoing: z.unknown().nullable(),
  strategies: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      note: z.string().nullable(),
      position: z.number().int(),
    }),
  ),
});

/**
 * The frame as read, with every revision since it was agreed (METHOD.md §2.1,
 * P9-T13-c-c), newest first. `before` is what the changed fields held.
 */
const frameReadOutput = frameOutput.extend({
  revisions: z.array(
    z.object({
      id: z.uuid(),
      fields: z.array(z.enum(FRAME_FIELDS)),
      before: z.record(z.string(), z.unknown()),
      reason: z.string(),
      revisedAt: z.string(),
      authorName: z.string().nullable(),
    }),
  ),
});

export const readAnnualFrame = defineReadAction({
  name: "frame.read",
  summary:
    "The current annual frame, its strategic thrusts, and every revision made since it was agreed.",
  input: z.object({}),
  output: frameReadOutput.nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const [frame] = await tx
          .select({
            id: annualFrames.id,
            yearLabel: annualFrames.yearLabel,
            horizonLabel: annualFrames.horizonLabel,
            agreed: annualFrames.agreed,
            mission: annualFrames.mission,
            vision: annualFrames.vision,
            strategy: annualFrames.strategy,
            notDoing: annualFrames.notDoing,
          })
          .from(annualFrames)
          .where(
            activeOnly(
              annualFrames,
              eq(annualFrames.workspaceId, context.workspaceId),
              isNull(annualFrames.supersededAt),
            ),
          )
          .limit(1);
        if (!frame) {
          return null;
        }

        const strategies = await tx
          .select({
            id: annualStrategies.id,
            text: annualStrategies.text,
            note: annualStrategies.note,
            position: annualStrategies.position,
          })
          .from(annualStrategies)
          .where(
            activeOnly(
              annualStrategies,
              eq(annualStrategies.workspaceId, context.workspaceId),
              eq(annualStrategies.frameId, frame.id),
            ),
          )
          .orderBy(asc(annualStrategies.position));

        const revisions = await tx
          .select({
            id: annualFrameRevisions.id,
            fields: annualFrameRevisions.fields,
            before: annualFrameRevisions.before,
            reason: annualFrameRevisions.reason,
            revisedAt: annualFrameRevisions.revisedAt,
            authorName: workspaceMembers.name,
          })
          .from(annualFrameRevisions)
          .leftJoin(
            workspaceMembers,
            eq(workspaceMembers.id, annualFrameRevisions.authorMemberId),
          )
          .where(
            activeOnly(
              annualFrameRevisions,
              eq(annualFrameRevisions.workspaceId, context.workspaceId),
              eq(annualFrameRevisions.frameId, frame.id),
            ),
          )
          .orderBy(desc(annualFrameRevisions.revisedAt));

        return {
          ...frame,
          strategies,
          revisions: revisions.map((revision) => ({
            ...revision,
            fields: [...revision.fields],
            revisedAt: new Date(revision.revisedAt).toISOString(),
          })),
        };
      },
    );
  },
});

/**
 * This year's objectives, each naming the strategy it serves (§2.1, P6-G14b).
 *
 * **An annual objective is one in a cycle whose mode is `annual`.** There is no
 * separate table and there should not be: §2.1's annual layer is a set of
 * objectives on a longer clock, judged by the same scoring and the same checks
 * as a quarterly one.
 *
 * `strategyId` is null for an objective nobody has linked yet, and the phase 0
 * panel lists those under their own heading rather than hiding them. An
 * objective serving no strategy is the thing §2.1 is trying to surface, not an
 * error to swallow.
 */
export const readAnnualObjectives = defineReadAction({
  name: "frame.annualObjectives",
  summary:
    "This year's annual objectives, each with the strategy it serves and whether it has been sent into a quarter.",
  input: z.object({}),
  output: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      strategyId: z.uuid().nullable(),
      championName: z.string().nullable(),
      keyResultCount: z.number().int(),
      /** How many quarterly objectives already hang off this one. */
      sentForward: z.number().int(),
    }),
  ),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      db,
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );
        await getAccessScoped(tx as OperationTx, {
          workspaceId: context.workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: context.workspaceId,
          requires: ACCESS_LEVELS.view,
        });

        const children = alias(goals, "children");
        const rows = await tx
          .select({
            id: goals.id,
            title: goals.title,
            strategyId: goals.strategyId,
            championName: workspaceMembers.name,
            keyResultCount: sql<number>`(
              select count(*)::int from key_results kr
              where kr.goal_id = ${goals.id} and kr.deleted_at is null
            )`,
            sentForward: sql<number>`(
              select count(*)::int from goals ${children}
              where ${children}.parent_goal_id = ${goals.id}
                and ${children}.deleted_at is null
            )`,
          })
          // openokr:allow-raw-read: `getAccessScoped` above confirmed workspace
          // access, which is what an annual objective is scoped by. The same
          // shape `frame.read` uses two actions above.
          .from(goals)
          .innerJoin(cycles, eq(cycles.id, goals.cycleId))
          .leftJoin(workspaceMembers, eq(workspaceMembers.id, goals.championId))
          .where(
            activeOnly(
              goals,
              eq(goals.workspaceId, context.workspaceId),
              eq(cycles.mode, "annual"),
            ),
          )
          .orderBy(goals.title);

        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          strategyId: row.strategyId,
          championName: row.championName,
          keyResultCount: Number(row.keyResultCount),
          sentForward: Number(row.sentForward),
        }));
      },
    );
  },
});

/**
 * A value as a string that does not depend on key order, so a frame field
 * read back from `jsonb`, which reorders keys, compares equal to the same
 * document sent again.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const setAnnualFrame = defineWriteAction({
  name: "frame.set",
  // openokr:policy-exempt: the annual frame is not an OKR write the practice governs; a revision of an agreed frame always needs its reason (METHOD.md §2.1), which this action asks for itself.
  summary:
    "Creates or replaces the current annual frame. A replacement supersedes rather than edits. Revising an agreed frame within its year needs a written reason, and the revision is kept.",
  input: z.object({
    yearLabel: z.string().trim().min(1).max(40),
    horizonLabel: z.string().trim().max(80).nullable().optional(),
    agreed: z.boolean().default(false),
    /**
     * The four prose fields (P6-G14). Absent leaves whatever the frame holds;
     * an explicit null clears it, which is how "we have not written a vision
     * yet" is said without inventing an empty document.
     */
    mission: frameProse.nullable().optional(),
    vision: frameProse.nullable().optional(),
    strategy: frameProse.nullable().optional(),
    notDoing: frameProse.nullable().optional(),
    /** Replaces the whole list, which is how a two-to-five set is edited. */
    strategies: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(280),
          note: z.string().trim().max(1000).nullable().optional(),
        }),
      )
      .max(20)
      .default([]),
    /**
     * Why an agreed frame changes within its year (METHOD.md §2.1,
     * P9-T13-c-c). Required then, and kept with the revision; ignored for a
     * frame still being drafted, and for a new year.
     */
    reason: z.string().trim().min(1).max(500).optional(),
  }),
  output: frameOutput,
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      const [current] = await tx
        .select({
          id: annualFrames.id,
          yearLabel: annualFrames.yearLabel,
          agreed: annualFrames.agreed,
          mission: annualFrames.mission,
          missionVersion: annualFrames.missionVersion,
          vision: annualFrames.vision,
          visionVersion: annualFrames.visionVersion,
          strategy: annualFrames.strategy,
          strategyVersion: annualFrames.strategyVersion,
          notDoing: annualFrames.notDoing,
          notDoingVersion: annualFrames.notDoingVersion,
        })
        .from(annualFrames)
        .where(
          activeOnly(
            annualFrames,
            eq(annualFrames.workspaceId, workspaceId),
            isNull(annualFrames.supersededAt),
          ),
        )
        .limit(1);

      // METHOD.md §2.1: a new year supersedes; the same year's frame is edited
      // in place, because recording a correction as a supersession would make
      // history unreadable. Since P9-T13-c-c an agreed frame may be revised
      // within its year with a written reason, and the revision is kept in
      // `annual_frame_revisions` with what the changed fields held before.
      let frameId = current?.id;
      let revised: readonly FrameField[] = [];
      // A new frame writes its strategies; the same year's frame only when
      // they changed (P9-T22c-c-b). Replacing an unchanged list gave every
      // strategy a new id, and the annual objectives aligned to the old ones
      // lost their strategy when somebody revised only the not-doing list.
      let replaceStrategies = true;
      if (current && current.yearLabel !== input.yearLabel) {
        await tx
          .update(annualFrames)
          .set({ supersededAt: new Date() })
          .where(activeOnly(annualFrames, eq(annualFrames.id, current.id)));
        frameId = undefined;
      }

      if (frameId && current) {
        const priorStrategies = await tx
          .select({ text: annualStrategies.text, note: annualStrategies.note })
          .from(annualStrategies)
          .where(
            activeOnly(
              annualStrategies,
              eq(annualStrategies.workspaceId, workspaceId),
              eq(annualStrategies.frameId, frameId),
            ),
          )
          .orderBy(asc(annualStrategies.position));
        const prose = {
          mission: input.mission,
          vision: input.vision,
          strategy: input.strategy,
          notDoing: input.notDoing,
        } as const;
        const changed: FrameField[] = (
          ["mission", "vision", "strategy", "notDoing"] as const
        ).filter(
          (field) =>
            prose[field] !== undefined &&
            canonical(prose[field]) !== canonical(current[field]),
        );
        if (
          canonical(
            input.strategies.map((entry) => ({
              text: entry.text,
              note: entry.note ?? null,
            })),
          ) !== canonical(priorStrategies)
        ) {
          changed.push("strategies");
        }
        replaceStrategies = changed.includes("strategies");
        // Withdrawing the agreement is itself a revision of an agreed frame:
        // otherwise a frame could be taken back to draft, rewritten with no
        // history and agreed again, and nobody would know why it changed.
        if (current.agreed && input.agreed === false) {
          changed.push("agreed");
        }

        // A draft keeps no history; an agreed frame keeps every revision.
        if (current.agreed && changed.length > 0) {
          if (!input.reason) {
            throw new OperationError(
              "forbidden",
              "This year's frame is agreed, so a revision needs a written reason (METHOD.md §2.1): what changed, and why it changes now.",
            );
          }
          const before = Object.fromEntries(
            changed.map((field) => [
              field,
              field === "strategies"
                ? priorStrategies
                : field === "agreed"
                  ? true
                  : current[field],
            ]),
          );
          await tx.insert(annualFrameRevisions).values({
            workspaceId,
            frameId,
            fields: changed,
            before,
            reason: input.reason,
            authorMemberId: actor.memberId,
          });
          revised = changed;
        }

        // The prose is written in place too. Before P9-T13-c-c only the
        // horizon and the agreement were, so an edit to the same year's
        // mission or not-doing list was answered as saved and dropped.
        await tx
          .update(annualFrames)
          .set({
            horizonLabel: input.horizonLabel ?? null,
            agreed: input.agreed,
            ...(input.mission === undefined
              ? {}
              : {
                  mission: input.mission,
                  missionVersion: RICH_TEXT_SCHEMA_VERSION,
                }),
            ...(input.vision === undefined
              ? {}
              : {
                  vision: input.vision,
                  visionVersion: RICH_TEXT_SCHEMA_VERSION,
                }),
            ...(input.strategy === undefined
              ? {}
              : {
                  strategy: input.strategy,
                  strategyVersion: RICH_TEXT_SCHEMA_VERSION,
                }),
            ...(input.notDoing === undefined
              ? {}
              : {
                  notDoing: input.notDoing,
                  notDoingVersion: RICH_TEXT_SCHEMA_VERSION,
                }),
            updatedAt: new Date(),
          })
          .where(activeOnly(annualFrames, eq(annualFrames.id, frameId)));
      } else {
        const [inserted] = await tx
          .insert(annualFrames)
          .values({
            workspaceId,
            yearLabel: input.yearLabel,
            horizonLabel: input.horizonLabel ?? null,
            agreed: input.agreed,
            // Carried from the superseded frame when this call does not name
            // one, so replacing a frame to add a strategy does not silently
            // drop the mission somebody wrote in January. Each version column
            // moves with its own field.
            mission: input.mission ?? current?.mission ?? null,
            missionVersion:
              input.mission === undefined
                ? (current?.missionVersion ?? null)
                : RICH_TEXT_SCHEMA_VERSION,
            vision: input.vision ?? current?.vision ?? null,
            visionVersion:
              input.vision === undefined
                ? (current?.visionVersion ?? null)
                : RICH_TEXT_SCHEMA_VERSION,
            strategy: input.strategy ?? current?.strategy ?? null,
            strategyVersion:
              input.strategy === undefined
                ? (current?.strategyVersion ?? null)
                : RICH_TEXT_SCHEMA_VERSION,
            notDoing: input.notDoing ?? current?.notDoing ?? null,
            notDoingVersion:
              input.notDoing === undefined
                ? (current?.notDoingVersion ?? null)
                : RICH_TEXT_SCHEMA_VERSION,
          })
          .returning({ id: annualFrames.id });
        if (!inserted) {
          throw new Error("The annual frame insert returned no row.");
        }
        frameId = inserted.id;
      }

      // The strategy list is replaced wholesale when it changes.
      // Soft-deleting the old rows rather than updating them keeps "what the
      // year's thrusts were in March" answerable after they change in June.
      if (replaceStrategies) {
        await tx
          .update(annualStrategies)
          .set({ deletedAt: new Date() })
          .where(
            activeOnly(
              annualStrategies,
              eq(annualStrategies.workspaceId, workspaceId),
              eq(annualStrategies.frameId, frameId),
            ),
          );

        for (const [index, strategy] of input.strategies.entries()) {
          await tx.insert(annualStrategies).values({
            workspaceId,
            frameId,
            text: strategy.text,
            note: strategy.note ?? null,
            position: index,
          });
        }
      }

      const strategies = await tx
        .select({
          id: annualStrategies.id,
          text: annualStrategies.text,
          note: annualStrategies.note,
          position: annualStrategies.position,
        })
        .from(annualStrategies)
        .where(
          activeOnly(
            annualStrategies,
            eq(annualStrategies.frameId, frameId),
            eq(annualStrategies.workspaceId, workspaceId),
          ),
        )
        .orderBy(asc(annualStrategies.position));

      return {
        result: {
          id: frameId,
          yearLabel: input.yearLabel,
          horizonLabel: input.horizonLabel ?? null,
          agreed: input.agreed,
          mission: input.mission ?? current?.mission ?? null,
          vision: input.vision ?? current?.vision ?? null,
          strategy: input.strategy ?? current?.strategy ?? null,
          notDoing: input.notDoing ?? current?.notDoing ?? null,
          strategies,
        },
        activity:
          revised.length > 0
            ? {
                kind: "frame.revised",
                subjectType: "workspace",
                subjectId: workspaceId,
                payload: {
                  yearLabel: input.yearLabel,
                  fields: [...revised],
                  reason: input.reason ?? "",
                },
              }
            : {
                kind: "frame.set",
                subjectType: "workspace",
                subjectId: workspaceId,
                payload: { yearLabel: input.yearLabel },
              },
        audit: {
          action: "frame.set",
          targetType: "annual_frame",
          targetId: frameId,
          payload: {
            yearLabel: input.yearLabel,
            strategies: input.strategies.length,
            superseded: Boolean(
              current && current.yearLabel !== input.yearLabel,
            ),
          },
        },
      };
    },
  }),
});

/**
 * Not `cycles.archive`: that name is taken, and it means something else. The
 * action above soft-deletes a cycle. This one records what the cycle achieved,
 * which METHOD.md §8.9 calls archiving and the plan calls the archive job. Two
 * different acts cannot share one verb, so the newer one is named for what it
 * writes.
 *
 * **`cycles.close` runs this as part of the close** (M-05), so no screen calls
 * it any more. It stays for the two callers that record a result without
 * closing: the demo builder, whose previous quarter has no retrospective, and
 * a re-run from the API before the close. It refuses a closed cycle, whose
 * result was fixed when it closed.
 */
export const snapshotCycle = defineWriteAction({
  name: "cycles.snapshot",
  summary:
    "Records what a cycle achieved: the result, the band counts and the portfolio verdict, one snapshot per owner.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    snapshots: z.number().int(),
    resultValue: z.number().nullable(),
    verdict: z.string().nullable(),
  }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      const result = await archiveCycleInTx(
        tx,
        workspaceId,
        input.cycleId,
        rhythm.thresholds,
      );
      return {
        result,
        activity: {
          kind: "cycle.snapshotted" as const,
          subjectType: "cycle" as const,
          subjectId: input.cycleId,
          payload: {
            snapshots: result.snapshots,
            verdict: result.verdict,
          },
        },
        audit: {
          action: "cycles.archive",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: { snapshots: result.snapshots },
        },
      };
    },
  }),
});

export const readScorecard = defineReadAction({
  name: "cycles.scorecard",
  summary:
    "Every archived cycle's result with its band counts and verdict, oldest first, each read under the rules it closed with, and what moved in it. Drives the scorecard.",
  input: z.object({}),
  output: z.object({
    rows: z.array(
      z.object({
        cycleId: z.uuid(),
        cycleName: z.string(),
        startsOn: z.string(),
        resultValue: z.number().nullable(),
        verdict: z.string().nullable(),
        fullyAchieved: z.number().int(),
        strong: z.number().int(),
        partial: z.number().int(),
        little: z.number().int(),
        /**
         * The bands this cycle was graded under (METHOD.md §12, P9-T14c),
         * from its own snapshot, and the band its result falls in.
         */
        bands: z.object({
          achieved: z.number(),
          strong: z.number(),
          partial: z.number(),
        }),
        resultBand: z
          .enum(["fully_achieved", "strong", "partial", "little"])
          .nullable(),
        /** What moved in it, so the close can see behind the number. */
        moved: z.object({
          adjusted: z.array(
            z.object({
              keyResultId: z.uuid(),
              title: z.string(),
              score: z.number(),
              computed: z.number(),
              reason: z.string(),
            }),
          ),
          eased: z.array(
            z.object({
              keyResultId: z.uuid(),
              title: z.string(),
              original: z.number(),
              target: z.number().nullable(),
              reason: z.string().nullable(),
            }),
          ),
          addedMidCycle: z.number().int(),
          kindChanges: z.array(
            z.object({
              goalId: z.uuid(),
              title: z.string(),
              from: z.string(),
              to: z.string(),
              reason: z.string().nullable(),
              at: z.string(),
            }),
          ),
        }),
      }),
    ),
    pointsEnabled: z.boolean(),
  }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const userId = context.actor.userId;
    if (!userId) {
      throw new OperationError("not_found", "No such workspace.");
    }
    return withContext(
      drizzle(context.pool),
      { workspaceId: context.workspaceId, userId },
      async (tx) => {
        // The workspace scope only. A space or a member reads their own trend
        // from their own page; a scorecard that mixed the three would add
        // numbers that answer different questions.
        const rows = await tx
          .select({
            cycleId: performanceSnapshots.cycleId,
            cycleName: cycles.name,
            startsOn: cycles.startsOn,
            resultValue: performanceSnapshots.resultValue,
            verdict: performanceSnapshots.verdict,
            fullyAchieved: performanceSnapshots.fullyAchievedCount,
            strong: performanceSnapshots.strongCount,
            partial: performanceSnapshots.partialCount,
            little: performanceSnapshots.littleCount,
          })
          .from(performanceSnapshots)
          .innerJoin(cycles, eq(cycles.id, performanceSnapshots.cycleId))
          .where(
            activeOnly(
              performanceSnapshots,
              eq(performanceSnapshots.workspaceId, context.workspaceId),
              eq(performanceSnapshots.ownerKind, "workspace"),
              // A deleted cycle has no place on the scorecard.
              isNull(cycles.deletedAt),
            ),
          )
          .orderBy(asc(cycles.startsOn));
        const memberId = await actingMember(
          tx as OperationTx,
          context.workspaceId,
          userId,
        );

        const [settings] = await tx
          .select({ enabled: scorecardSettings.enabled })
          .from(scorecardSettings)
          .where(
            activeOnly(
              scorecardSettings,
              eq(scorecardSettings.workspaceId, context.workspaceId),
            ),
          )
          .limit(1);

        // Each cycle read under the rules it closed with (§12, P9-T14c), so
        // a band moved since colours only the cycles graded after it.
        const shaped = [];
        for (const row of rows) {
          const rules = await cycleRulesInTx(
            tx as OperationTx,
            context.workspaceId,
            row.cycleId,
          );
          const resultValue =
            row.resultValue === null ? null : Number(row.resultValue);
          shaped.push({
            ...row,
            resultValue,
            bands: scoreBandsIn(rules.thresholds, rules.practice),
            resultBand:
              resultValue === null
                ? null
                : scoreBand(resultValue, rules.thresholds, rules.practice),
            moved: await cycleMovesInTx(tx as OperationTx, {
              workspaceId: context.workspaceId,
              memberId,
              cycleId: row.cycleId,
            }),
          });
        }

        return {
          rows: shaped,
          // No row means off, which is the default and needs no row to say so.
          pointsEnabled: settings?.enabled ?? false,
        };
      },
    );
  },
});

const feedForwardOutput = z.object({
  priorScores: z.number().int(),
  issues: z.number().int(),
  frameCarried: z.boolean(),
  /** Rows of the mapping this build cannot fill, each naming its task. Empty since P4-T12-b. */
  waiting: z.array(z.string()),
  /**
   * The process-health statement the next cycle now holds in Phase 3 as its
   * improvement action, or null when the survey went unanswered (M-05).
   */
  processPriority: z.string().nullable(),
  /** Whether the learnings reached the next cycle's input pack. */
  packNote: z.boolean(),
  /**
   * Kept and modified objectives this run pre-filled as drafts, and the ones
   * it could not because their champion has left, by title (§8.9, P9-T20e-b).
   */
  drafts: z.number().int(),
  notCarried: z.array(z.string()),
});

/**
 * **`cycles.close` feeds the next cycle itself** (M-05), and creating a cycle
 * after a close feeds it too, so no screen calls this any more. It stays as an
 * idempotent re-run for the API and the command line: running it again adds
 * nothing that is already there.
 */
export const feedForwardCycle = defineWriteAction({
  name: "cycles.feedForward",
  summary:
    "Re-runs METHOD.md §8.9's inheritance into a named cycle: prior scores, carried work and deferred objectives as issues, kept and modified objectives as pre-filled drafts, learnings into the input pack, the lowest process-health statement as an improvement action, and the annual frame. Closing a cycle already does this.",
  input: z.object({ fromCycleId: z.uuid(), toCycleId: z.uuid() }),
  output: feedForwardOutput,
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const result = await feedForwardInTx(
        tx,
        workspaceId,
        input.fromCycleId,
        input.toCycleId,
      );
      return {
        result: {
          ...result,
          waiting: [...result.waiting],
          notCarried: [...result.notCarried],
        },
        activity: {
          kind: "cycle.fed_forward" as const,
          subjectType: "cycle" as const,
          subjectId: input.toCycleId,
          payload: {
            priorScores: result.priorScores,
            issues: result.issues,
          },
        },
        audit: {
          action: "cycles.feedForward",
          targetType: "cycle",
          targetId: input.toCycleId,
          payload: {
            from: input.fromCycleId,
            priorScores: result.priorScores,
            issues: result.issues,
            drafts: result.drafts,
          },
        },
      };
    },
  }),
});

/**
 * Closes a cycle (METHOD.md §2.2 phase 7, §8.9; completeness review M-05).
 *
 * §8.9: "At close, the product feeds the next cycle automatically." One
 * Operation records the archive, marks the cycle closed and feeds the next
 * cycle of the same mode when it exists. Refused until phase 7 is complete,
 * with the reason; `closeCycleInTx` says why there is no override.
 *
 * `full`, the same as publishing: closing is the other end of the act that
 * publication starts, and it fixes the result the scorecard will show for good.
 * Not destructive in the registry's sense, because nothing a person can see is
 * removed.
 */
export const closeCycle = defineWriteAction({
  name: "cycles.close",
  summary:
    "Closes a cycle once phase 7 is complete: records its result on the scorecard and feeds the next cycle its prior scores, carried work, kept objectives as drafts, learnings and improvement action.",
  input: z.object({ cycleId: z.uuid() }),
  output: z.object({
    cycleId: z.uuid(),
    snapshots: z.number().int(),
    resultValue: z.number().nullable(),
    verdict: z.string().nullable(),
    /** The cycle fed at close, or null when the next one does not exist yet. */
    fedInto: feedForwardOutput
      .extend({ cycleId: z.uuid(), name: z.string() })
      .nullable(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const rhythm = resolveRhythm(await readRhythmRow(tx, workspaceId));
      const closed = await closeCycleInTx(
        tx,
        workspaceId,
        input.cycleId,
        rhythm.thresholds,
      );
      const fedInto = closed.fedInto
        ? {
            cycleId: closed.fedInto.cycleId,
            name: closed.fedInto.name,
            ...closed.fedInto.result,
            waiting: [...closed.fedInto.result.waiting],
            notCarried: [...closed.fedInto.result.notCarried],
          }
        : null;
      return {
        result: {
          cycleId: input.cycleId,
          snapshots: closed.archive.snapshots,
          resultValue: closed.archive.resultValue,
          verdict: closed.archive.verdict,
          fedInto,
        },
        activity: {
          kind: "cycle.closed" as const,
          subjectType: "cycle" as const,
          subjectId: input.cycleId,
          payload: {
            name: closed.name,
            verdict: closed.archive.verdict,
            fedInto: closed.fedInto?.name ?? null,
          },
        },
        audit: {
          action: "cycles.close",
          targetType: "cycle",
          targetId: input.cycleId,
          payload: {
            name: closed.name,
            snapshots: closed.archive.snapshots,
            resultValue: closed.archive.resultValue,
            verdict: closed.archive.verdict,
            fedInto: fedInto
              ? {
                  cycleId: fedInto.cycleId,
                  priorScores: fedInto.priorScores,
                  issues: fedInto.issues,
                  drafts: fedInto.drafts,
                  processPriority: fedInto.processPriority,
                  packNote: fedInto.packNote,
                }
              : null,
          },
        },
      };
    },
  }),
});
