/**
 * Load and soak scenarios (P7-T02).
 *
 * **What this drives, and what it deliberately does not.** Every scenario here
 * runs through `callAction`, which is the layer where the permission decision,
 * the Operation pipeline and every query live. It is not an HTTP load test:
 * Next.js, the reverse proxy and the connection pool in front of them are not
 * exercised, and neither is realtime fan-out, because a session's stage
 * transition reaching twenty browsers is a property of the event stream rather
 * than of the action that moved the stage.
 *
 * That boundary is stated rather than hidden. The rows it leaves uncovered are
 * the same ones the §13.1 budget table hands to another task: fan-out and
 * channel delivery need a running server and a provider, and P7-T02's own
 * acceptance names them. What this covers is the half that can be measured
 * honestly without one, which is every read and write a member makes.
 *
 * **Concurrency is members, not requests.** A virtual member picks a scenario,
 * runs it, waits a moment as a person would, and goes again. Firing requests
 * as fast as the process can is a benchmark of this process; what the
 * acceptance asks about is hundreds of people using one workspace.
 */
import type pg from "pg";
import { callAction } from "../actions/registry.ts";
import { percentile } from "./budgets.ts";

export interface LoadActor {
  readonly userId: string;
  readonly memberId: string;
  /**
   * The spaces this member can edit in.
   *
   * A member holds `edit` on a task through their space's `space_standard`
   * group, so a drag scenario that picked any task in the workspace failed
   * most of the time and reported it as a product error. It was the harness
   * asking somebody to move a card in a team they are not on.
   */
  readonly spaceIds: readonly string[];
}

export interface LoadWorld {
  readonly pool: pg.Pool;
  readonly workspaceId: string;
  readonly actors: readonly LoadActor[];
  readonly spaceIds: readonly string[];
  /** Task ids per space, so a drag stays inside a space its actor is in. */
  readonly tasksBySpace: ReadonlyMap<string, readonly string[]>;
  readonly cycleId: string;
}

export interface Scenario {
  readonly name: string;
  /** Share of a member's actions that are this one, out of the total weight. */
  readonly weight: number;
  /** Whether it writes. A soak reports reads and writes separately. */
  readonly writes: boolean;
  /**
   * The p95 this scenario is judged against, in milliseconds.
   *
   * §13.1's own figure for the screen it drives, rather than one number for
   * everything: the alignment recomputation is allowed two seconds and the
   * review inbox five hundred milliseconds, and judging both against one
   * ceiling either lets the inbox rot or fails the recomputation for meeting
   * its own budget. The first version of this used a flat 500ms and reported
   * alignment red at 837ms, which was wrong.
   */
  readonly budgetMs: number;
  run(world: LoadWorld, actor: LoadActor, tick: number): Promise<void>;
}

const TASK_STATUSES = ["backlog", "todo", "in_progress", "done"] as const;

/**
 * What a workspace does all day.
 *
 * The weights are a working day rather than an even split: people read their
 * map and their board far more often than they move a card, and a load profile
 * that wrote as often as it read would measure a product nobody uses.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    name: "work-map",
    weight: 30,
    writes: false,
    budgetMs: 1000,
    async run(world, actor) {
      await callAction(
        context(world, actor) as never,
        "goals.list" as never,
        {} as never,
      );
    },
  },
  {
    name: "feed",
    weight: 20,
    writes: false,
    budgetMs: 500,
    async run(world, actor) {
      await callAction(
        context(world, actor) as never,
        "activities.workspaceFeed" as never,
        {} as never,
      );
    },
  },
  {
    name: "board",
    weight: 20,
    writes: false,
    budgetMs: 1500,
    async run(world, actor, tick) {
      // A space this member is in, so the board is one they would open.
      const spaceId =
        actor.spaceIds[tick % Math.max(actor.spaceIds.length, 1)] ??
        world.spaceIds[tick % world.spaceIds.length];
      await callAction(
        context(world, actor) as never,
        "tasks.board" as never,
        { spaceId } as never,
      );
    },
  },
  {
    name: "review-inbox",
    weight: 15,
    writes: false,
    budgetMs: 500,
    async run(world, actor) {
      await callAction(
        context(world, actor) as never,
        "review.inbox" as never,
        {} as never,
      );
    },
  },
  {
    name: "alignment",
    weight: 5,
    writes: false,
    budgetMs: 2000,
    async run(world, actor) {
      await callAction(
        context(world, actor) as never,
        "alignment.read" as never,
        { cycleId: world.cycleId } as never,
      );
    },
  },
  {
    // The board drag §13.1's "Save actions" row is about: a real write through
    // the Operation pipeline, with its audit and outbox rows.
    name: "drag",
    weight: 10,
    writes: true,
    budgetMs: 500,
    async run(world, actor, tick) {
      const spaceId = actor.spaceIds[tick % Math.max(actor.spaceIds.length, 1)];
      const inSpace = spaceId ? world.tasksBySpace.get(spaceId) : undefined;
      if (!inSpace || inSpace.length === 0) {
        return;
      }
      const id = inSpace[tick % inSpace.length];
      if (!id) {
        return;
      }
      await callAction(
        context(world, actor) as never,
        "tasks.move" as never,
        {
          id,
          status: TASK_STATUSES[tick % TASK_STATUSES.length],
        } as never,
      );
    },
  },
];

function context(world: LoadWorld, actor: LoadActor) {
  return {
    pool: world.pool,
    workspaceId: world.workspaceId,
    actor: { kind: "human" as const, userId: actor.userId },
  };
}

/**
 * Picks a scenario by weight, deterministically for a given tick.
 *
 * **Hashed, not `tick % total`.** Consecutive ticks walked the weight range in
 * order, so a member did thirty work-maps, then twenty feeds, and a run that
 * ended before the cursor reached the end never touched the last scenarios at
 * all: the first version of this reported zero calls for review-inbox,
 * alignment and drag, which reads as three broken scenarios and was one broken
 * picker. Hashing spreads the same weights across ticks instead of walking
 * them, and stays reproducible.
 */
export function scenarioFor(tick: number): Scenario {
  const total = SCENARIOS.reduce((sum, one) => sum + one.weight, 0);
  // xorshift on the tick, so neighbouring ticks land far apart.
  let hashed = (tick + 1) * 2654435761;
  hashed ^= hashed >>> 13;
  hashed = Math.imul(hashed, 1274126177) >>> 0;
  let cursor = hashed % total;
  for (const scenario of SCENARIOS) {
    if (cursor < scenario.weight) {
      return scenario;
    }
    cursor -= scenario.weight;
  }
  return SCENARIOS[0] as Scenario;
}

interface ScenarioResult {
  readonly name: string;
  readonly writes: boolean;
  readonly calls: number;
  readonly errors: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  /** The ceiling this scenario is judged against. */
  readonly budgetMs: number;
  /** The first failure, so a run that goes wrong says why once. */
  readonly firstError?: string;
}

export interface LoadResult {
  readonly seconds: number;
  readonly scenarios: readonly ScenarioResult[];
  readonly calls: number;
  readonly errors: number;
  /**
   * The p95 of the second half against the first.
   *
   * A soak is not about the number, it is about whether the number moves. A
   * run whose second half is materially slower is leaking something, and the
   * ratio says so in one figure.
   */
  readonly drift: number;
}

interface Sample {
  readonly scenario: string;
  readonly ms: number;
  readonly at: number;
  readonly error?: string;
}

export interface LoadOptions {
  readonly world: LoadWorld;
  /** How many virtual members act at once. */
  readonly concurrency: number;
  readonly seconds: number;
  /** Milliseconds a member waits between actions. */
  readonly thinkMs?: number;
  readonly onTick?: (elapsed: number, calls: number, errors: number) => void;
}

/** Runs the profile and reports what happened. */
export async function runLoad(options: LoadOptions): Promise<LoadResult> {
  const { world, concurrency, seconds } = options;
  const thinkMs = options.thinkMs ?? 250;
  const started = Date.now();
  const until = started + seconds * 1000;
  const samples: Sample[] = [];
  let calls = 0;
  let errors = 0;

  const member = async (slot: number): Promise<void> => {
    const actor = world.actors[slot % world.actors.length];
    if (!actor) {
      return;
    }
    // Each virtual member starts at a different point in the profile, so the
    // run does not begin with every one of them doing the same thing.
    let tick = slot;
    while (Date.now() < until) {
      const scenario = scenarioFor(tick);
      const at = Date.now();
      try {
        await scenario.run(world, actor, tick);
        samples.push({ scenario: scenario.name, ms: Date.now() - at, at });
      } catch (error) {
        errors += 1;
        samples.push({
          scenario: scenario.name,
          ms: Date.now() - at,
          at,
          error: (error as Error).message,
        });
      }
      calls += 1;
      tick += 1;
      if (thinkMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, thinkMs));
      }
    }
  };

  const ticker = options.onTick
    ? setInterval(() => {
        options.onTick?.(
          Math.round((Date.now() - started) / 1000),
          calls,
          errors,
        );
      }, 5_000)
    : undefined;

  await Promise.all(
    Array.from({ length: concurrency }, (_value, slot) => member(slot)),
  );
  if (ticker) {
    clearInterval(ticker);
  }

  const midpoint = started + ((Date.now() - started) / 2 || 0);
  const firstHalf = samples.filter((one) => one.at < midpoint).map((s) => s.ms);
  const secondHalf = samples
    .filter((one) => one.at >= midpoint)
    .map((s) => s.ms);
  const firstP95 = percentile(firstHalf, 0.95);
  const secondP95 = percentile(secondHalf, 0.95);

  return {
    seconds: (Date.now() - started) / 1000,
    calls,
    errors,
    drift: firstP95 === 0 ? 1 : secondP95 / firstP95,
    scenarios: SCENARIOS.map((scenario) => {
      const mine = samples.filter((one) => one.scenario === scenario.name);
      const times = mine.map((one) => one.ms);
      const failed = mine.filter((one) => one.error !== undefined);
      const first = failed[0]?.error;
      return {
        name: scenario.name,
        writes: scenario.writes,
        budgetMs: scenario.budgetMs,
        calls: mine.length,
        errors: failed.length,
        p50: percentile(times, 0.5),
        p95: percentile(times, 0.95),
        p99: percentile(times, 0.99),
        ...(first === undefined ? {} : { firstError: first }),
      };
    }),
  };
}
