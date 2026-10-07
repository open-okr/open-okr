/**
 * The Northwind year's runner (P9-T22c-a,
 * `docs/design/p9-t22c-northwind-year.md` §3).
 *
 * The seed is a list of dated events. This runs every event whose date, on
 * the real calendar, is on or before today, **in date order**, so a setting
 * changed in April is changed after the quarter that closed in March and
 * before the one that publishes in April. Each closed cycle then keeps the
 * rules it was graded under, which no amount of writing the end state
 * directly would give.
 */
import type { Pool } from "pg";
import { callAction } from "../../actions/registry.ts";
import { toReal } from "./calendar.ts";
import type { YearKpiKey } from "./kpis.ts";
import type { YearPersonKey, YearSpaceKey } from "./people.ts";

export interface YearSeed {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** Every write is made as the person who registered the workspace: Elena. */
  readonly adminUserId: string;
}

/** What the events have written so far, by the scenario's own names. */
interface YearIds {
  readonly people: Map<YearPersonKey, string>;
  readonly spaces: Map<YearSpaceKey, string>;
  readonly kpis: Map<YearKpiKey, string>;
  /** Cycles by a name the events choose: "annual", "q1", "pilot". */
  readonly cycles: Map<string, string>;
  /** Objectives and key results by the scenario's labels: "a1", "a3.soc2". */
  readonly goals: Map<string, string>;
  readonly keyResults: Map<string, string>;
  /** Dependencies by a label the events choose: "P1.1-engineering". */
  readonly dependencies: Map<string, string>;
  /** Blockers by the key result they block: "C1.3". */
  readonly blockers: Map<string, string>;
  /** Sessions a later event comes back to: "q2:retrospective". */
  readonly sessions: Map<string, string>;
  /** The annual frame's strategies, in the frame's order. */
  strategies: string[];
}

export interface YearContext {
  readonly seed: YearSeed;
  /** The real year that holds today, where the scenario's 2027 lands. */
  readonly realYear: number;
  /** Today, `YYYY-MM-DD`. */
  readonly today: string;
  /** The real date of the event being written, set by the runner. */
  on: string;
  readonly ids: YearIds;
  /** The context every action is called with. */
  readonly action: {
    readonly pool: Pool;
    readonly workspaceId: string;
    readonly actor: { readonly kind: "human"; readonly userId: string };
  };
  /** A scenario date on the real calendar. */
  real(scenarioDate: string): string;
}

export interface YearEvent {
  /** The scenario date it happens on. */
  readonly on: string;
  /** The step it belongs to, where it belongs to one. */
  readonly step?: string;
  /** What it does, in a few words: printed by the command, read in a failure. */
  readonly label: string;
  /**
   * Its place among events on the same day, lowest first. Most leave it at
   * zero and run in the order they are listed; a few must run after others,
   * such as a space archived after its objectives have moved out of it.
   */
  readonly order?: number;
  run(context: YearContext): Promise<void>;
}

export function yearContext(seed: YearSeed, today: string): YearContext {
  const realYear = Number(today.slice(0, 4));
  return {
    seed,
    realYear,
    today,
    on: today,
    ids: {
      people: new Map(),
      spaces: new Map(),
      kpis: new Map(),
      cycles: new Map(),
      goals: new Map(),
      keyResults: new Map(),
      dependencies: new Map(),
      blockers: new Map(),
      sessions: new Map(),
      strategies: [],
    },
    action: {
      pool: seed.pool,
      workspaceId: seed.workspaceId,
      actor: { kind: "human", userId: seed.adminUserId },
    },
    real: (scenarioDate) => toReal(scenarioDate, realYear),
  };
}

/**
 * The events due by today, in the order they run: by real date, then by
 * their order, then as listed. Exported so a test can read the plan without
 * writing it.
 */
export function eventsDue(
  events: readonly YearEvent[],
  today: string,
): YearEvent[] {
  const realYear = Number(today.slice(0, 4));
  return events
    .map((event, index) => ({
      event,
      index,
      on: toReal(event.on, realYear),
    }))
    .filter((entry) => entry.on <= today)
    .sort(
      (a, b) =>
        a.on.localeCompare(b.on) ||
        (a.event.order ?? 0) - (b.event.order ?? 0) ||
        a.index - b.index,
    )
    .map((entry) => entry.event);
}

/** Runs the events due by today, in order, and names the one that failed. */
export async function runYear(
  context: YearContext,
  events: readonly YearEvent[],
): Promise<number> {
  const due = eventsDue(events, context.today);
  for (const event of due) {
    context.on = context.real(event.on);
    try {
      await event.run(context);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The Northwind year stopped at "${event.label}" (${event.step ?? "no step"}, ${context.real(event.on)}): ${reason}`,
      );
    }
  }
  return due.length;
}

/**
 * The cycle of a mode that holds a real date, created if it does not exist
 * yet. Provisioning made the current quarter, and everything else the year
 * needs is created on the day it is first reached.
 */
export async function cycleHolding(
  context: YearContext,
  on: string,
  mode: "annual" | "quarterly",
): Promise<{ id: string; startsOn: string; endsOn: string }> {
  const all = await callAction(context.action, "cycles.list", {});
  const found = all.find(
    (cycle) =>
      cycle.mode === mode && cycle.startsOn <= on && cycle.endsOn >= on,
  );
  if (found) {
    return { id: found.id, startsOn: found.startsOn, endsOn: found.endsOn };
  }
  const created = await callAction(context.action, "cycles.create", {
    on,
    mode,
    firstCycle: false,
  });
  return {
    id: created.id,
    startsOn: created.startsOn,
    endsOn: created.endsOn,
  };
}

/** A required id, or a failure that names what was missing. */
export function need<K>(map: Map<K, string>, key: K, what: string): string {
  const id = map.get(key);
  if (!id) {
    throw new Error(`${what} "${String(key)}" has not been written yet.`);
  }
  return id;
}
