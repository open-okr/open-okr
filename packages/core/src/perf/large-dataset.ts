/**
 * The large seeded dataset the performance budgets are measured on
 * (P7-T01a, TECHNICAL-PLAN §13.1).
 *
 * §13.1 names the shape: "100,000 goals and key results plus 1,000,000 tasks
 * in one workspace". Read here as 100,000 goals and 100,000 key results,
 * because the other reading gives a workspace of goals with almost nothing to
 * measure, and a key result is what every budget on that page actually reads.
 * Both counts are flags, so a different reading costs a command-line argument
 * rather than a rewrite.
 *
 * **What makes this dataset honest, and what would make it a lie.**
 *
 * *Access rows are not optional.* Every goal owns an access context and four
 * bindings (`goals/service.ts` says which and why). A seeder that skipped them
 * would produce a hundred thousand goals that `getAccessScoped` cannot see, so
 * every list budget would be measured against an empty result and every number
 * would come back green. The bindings are the bulk of the rows here, and that
 * is the point.
 *
 * *Keys are spread over time.* `newId` is a time-ordered UUID precisely so
 * that inserts append rather than scatter. A million ids minted in one run all
 * carry the same 48-bit prefix and land in one region of the B-tree, which is
 * not the tree production has. Every id here is minted at the moment its row
 * pretends to have been written, spread across `spreadDays`.
 *
 * *Rows are shaped like real ones.* Goals sit at four levels under real
 * champions and reviewers in real spaces, tasks belong to initiatives and key
 * results, statuses and health are distributed rather than constant. A column
 * holding one value everywhere gives the planner a selectivity it will never
 * see in production.
 *
 * *It writes through the tenant floor.* Every batch runs with
 * `app.workspace_id` set, so row-level security is deciding, not the seeder's
 * good manners.
 *
 * **What it deliberately does not do.** No activity rows, no audit rows, no
 * outbox rows, and no Operation per row. `perf/bulk.ts` carries that
 * reasoning. The consequence is stated rather than hidden: this dataset is for
 * measuring reads and plans, and it is not a substitute for the fixtures a
 * behaviour test builds through the pipeline.
 */
import { newId } from "@openokr/db";
import type pg from "pg";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  BULK_BATCH,
  type BulkColumn,
  bulkInsert,
  inTenantTransaction,
} from "./bulk.ts";

/** How many rows of each kind the dataset holds. */
export interface LargeDatasetCounts {
  readonly spaces: number;
  readonly members: number;
  readonly goals: number;
  readonly keyResults: number;
  readonly initiatives: number;
  readonly tasks: number;
}

/**
 * §13.1's figures.
 *
 * Spaces and members are not in §13.1 and are chosen to make the goal tree
 * plausible rather than to hit a target: twenty spaces and two hundred people
 * is a mid-sized company, which is the population the budgets describe. They
 * also decide how selective a space filter is, and a list budget measured in
 * a workspace with one space would prove nothing about the index behind it.
 */
export const LARGE_DATASET: LargeDatasetCounts = {
  spaces: 20,
  members: 200,
  goals: 100_000,
  keyResults: 100_000,
  initiatives: 5_000,
  tasks: 1_000_000,
};

export interface LargeDatasetOptions {
  readonly pool: pg.Pool;
  readonly workspaceId: string;
  readonly counts?: Partial<LargeDatasetCounts>;
  /** How far back the oldest row pretends to have been written. */
  readonly spreadDays?: number;
  readonly batchSize?: number;
  /** Called after each table, for the command's progress lines. */
  readonly onProgress?: (table: string, rows: number, seconds: number) => void;
  /**
   * The instance's `NODE_ENV`. Defaults to the process's own, and exists as an
   * option so the refusal below can be tested without setting a global.
   */
  readonly nodeEnv?: string | undefined;
}

/**
 * Refuses to build the dataset on a production instance.
 *
 * A hundred thousand objectives called `Objective 1` in a workspace real
 * people use is not a mess that can be tidied afterwards: the rows carry no
 * marker distinguishing them from real work, and deleting them by pattern
 * would be a guess. The refusal is here, in the builder, rather than only in
 * the command, so a script that imports this cannot route around it.
 *
 * There is deliberately no override flag. An escape hatch on a guard like this
 * becomes the thing every runbook tells you to pass, and then the guard is
 * decoration. An operator who genuinely means it can say so by not running a
 * production process.
 */
function assertSeedable(nodeEnv: string | undefined): void {
  if (nodeEnv === "production") {
    throw new Error(
      "The performance dataset is refused on a production instance. It writes a hundred thousand placeholder objectives that carry no marker separating them from real work, so there is no clean way back.",
    );
  }
}

/** What was written, per table. */
export interface LargeDatasetReport {
  readonly rows: Readonly<Record<string, number>>;
  readonly seconds: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** The seed every run shares, so the dataset is reproducible. */
const DATASET_SEED = 20260910;

/** Goal levels, in the proportion an organisation actually holds them. */
const LEVELS = [
  "company",
  "department",
  "department",
  "team",
  "team",
  "team",
  "individual",
  "individual",
  "individual",
  "individual",
] as const;

/** Health, weighted the way a mid-quarter workspace reads. */
const HEALTH = [
  "on_track",
  "on_track",
  "on_track",
  "caution",
  "caution",
  "off_track",
  "outdated",
  "pending",
] as const;

const DIRECTIONS = ["increase", "increase", "reduce", "maintain"] as const;
const INDICATORS = ["leading", "lagging"] as const;
const TASK_STATUS = [
  "backlog",
  "backlog",
  "todo",
  "todo",
  "in_progress",
  "done",
  "done",
  "done",
] as const;
const INITIATIVE_STATUS = ["planned", "active", "active", "done"] as const;

/**
 * A deterministic pseudo-random source.
 *
 * Seeded rather than `Math.random`, so two runs of the same command produce
 * the same shape and a plan regression can be compared against a plan taken
 * yesterday. mulberry32: four lines, no dependency, and far better
 * distribution than the `x * 9301 + 49297` folklore.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks from a weighted list by index. */
function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)] as T;
}

/**
 * Generates `total` rows in chunks and inserts each chunk as it is built.
 *
 * The alternative, building a million-row array and handing it to
 * `bulkInsert`, needs the whole dataset resident at once. This keeps one
 * batch in memory whatever the total, which is what lets the command run
 * inside a normal container.
 */
async function insertGenerated(
  pool: pg.Pool,
  workspaceId: string,
  table: string,
  columns: readonly BulkColumn[],
  total: number,
  batchSize: number,
  row: (index: number) => readonly unknown[],
): Promise<number> {
  let written = 0;
  for (let start = 0; start < total; start += batchSize) {
    const size = Math.min(batchSize, total - start);
    const rows = Array.from({ length: size }, (_value, offset) =>
      row(start + offset),
    );
    // A transaction per batch rather than one around the whole table: a
    // million rows in one transaction holds a single snapshot open for
    // minutes and leaves nothing behind if it fails at 90%.
    written += await inTenantTransaction(pool, workspaceId, (client) =>
      bulkInsert(client, table, columns, rows, batchSize),
    );
  }
  return written;
}

const CONTEXT_COLUMNS: readonly BulkColumn[] = [
  { name: "id", type: "uuid" },
  { name: "workspace_id", type: "uuid" },
  { name: "resource_type", type: "text" },
  { name: "resource_id", type: "uuid" },
  { name: "created_at", type: "timestamptz" },
  { name: "updated_at", type: "timestamptz" },
];

const BINDING_COLUMNS: readonly BulkColumn[] = [
  { name: "id", type: "uuid" },
  { name: "workspace_id", type: "uuid" },
  { name: "group_id", type: "uuid" },
  { name: "context_id", type: "uuid" },
  { name: "level", type: "int4" },
  { name: "tag", type: "text" },
  { name: "created_at", type: "timestamptz" },
];

/** Reads what the provisioned workspace already holds. */
async function readAnchors(
  pool: pg.Pool,
  workspaceId: string,
): Promise<{
  ownerMemberId: string;
  spaceIds: string[];
  cycleId: string;
  workspaceStandardGroupId: string;
  goalCount: number;
}> {
  return inTenantTransaction(pool, workspaceId, async (client) => {
    const member = await client.query<{ id: string }>(
      "select id from workspace_members where workspace_id = $1 and deleted_at is null and kind = 'human' order by created_at limit 1",
      [workspaceId],
    );
    const spaces = await client.query<{ id: string }>(
      "select id from spaces where workspace_id = $1 and deleted_at is null order by created_at",
      [workspaceId],
    );
    const cycle = await client.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on desc limit 1",
      [workspaceId],
    );
    const group = await client.query<{ id: string }>(
      "select id from access_groups where workspace_id = $1 and kind = 'workspace_standard' and deleted_at is null limit 1",
      [workspaceId],
    );
    const goals = await client.query<{ n: string }>(
      "select count(*)::text as n from goals where workspace_id = $1",
      [workspaceId],
    );

    const ownerMemberId = member.rows[0]?.id;
    const cycleId = cycle.rows[0]?.id;
    const workspaceStandardGroupId = group.rows[0]?.id;
    if (!ownerMemberId || !cycleId || !workspaceStandardGroupId) {
      throw new Error(
        "This workspace is missing its first member, its cycle or its standard group. Provision it through the normal path first.",
      );
    }
    return {
      ownerMemberId,
      spaceIds: spaces.rows.map((row) => row.id),
      cycleId,
      workspaceStandardGroupId,
      goalCount: Number(goals.rows[0]?.n ?? "0"),
    };
  });
}

/**
 * Fills `workspaceId` with the §13.1 dataset.
 *
 * Refuses a workspace that already holds goals. This is not idempotent in the
 * importer's sense and does not pretend to be: running it twice would double
 * the dataset and quietly invalidate every number measured against it, so it
 * stops instead.
 */
export async function buildLargeDataset(
  options: LargeDatasetOptions,
): Promise<LargeDatasetReport> {
  assertSeedable(
    options.nodeEnv === undefined ? process.env.NODE_ENV : options.nodeEnv,
  );
  const started = Date.now();
  const counts: LargeDatasetCounts = { ...LARGE_DATASET, ...options.counts };
  const batchSize = options.batchSize ?? BULK_BATCH;
  const spreadDays = options.spreadDays ?? 365;
  const { pool, workspaceId } = options;
  // A fixed seed, so two runs of the same command produce the same dataset
  // and a plan taken today can be compared with one taken last week.
  const random = seededRandom(DATASET_SEED);
  const rows: Record<string, number> = {};

  const report = (table: string, written: number, from: number): void => {
    rows[table] = written;
    options.onProgress?.(table, written, (Date.now() - from) / 1000);
  };

  const anchors = await readAnchors(pool, workspaceId);
  if (anchors.goalCount > 0) {
    throw new Error(
      `This workspace already holds ${anchors.goalCount} goal(s). The dataset is built into an empty workspace, because a second run would double it and every measured budget would be measuring something else.`,
    );
  }

  const now = Date.now();
  const oldest = now - spreadDays * DAY;
  /** The millisecond row `index` of `total` pretends to have been written. */
  const at = (index: number, total: number): number =>
    Math.floor(oldest + ((now - oldest) * index) / Math.max(total, 1));

  // --- Members -------------------------------------------------------------
  // Placeholder people, the same shape the demo builder writes: no user
  // account, active, human. They exist to be champions, reviewers and owners,
  // which is what makes a goal's bindings resolve to different principals
  // instead of all pointing at one.
  let step = Date.now();
  const memberIds: string[] = [];
  await insertGenerated(
    pool,
    workspaceId,
    "workspace_members",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "name", type: "text" },
      { name: "title", type: "text" },
      { name: "kind", type: "text" },
      { name: "status", type: "text" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    counts.members,
    batchSize,
    (index) => {
      const when = at(index, counts.members);
      const id = newId(when);
      memberIds.push(id);
      return [
        id,
        workspaceId,
        `Member ${index + 1}`,
        "Placeholder",
        "human",
        "active",
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("workspace_members", memberIds.length, step);

  // Their own access groups. `bindRole` would create one per goal on demand;
  // in bulk they are made once here and referenced a hundred thousand times.
  step = Date.now();
  const memberGroupIds = new Map<string, string>();
  await insertGenerated(
    pool,
    workspaceId,
    "access_groups",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "kind", type: "text" },
      { name: "member_id", type: "uuid" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    memberIds.length,
    batchSize,
    (index) => {
      const memberId = memberIds[index] as string;
      const when = at(index, memberIds.length);
      const id = newId(when);
      memberGroupIds.set(memberId, id);
      return [
        id,
        workspaceId,
        "member",
        memberId,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("access_groups", memberGroupIds.size, step);

  // Everyone joins `workspace_standard`, which is what a goal's view binding
  // resolves through. Without this the goals are visible to nobody.
  step = Date.now();
  await insertGenerated(
    pool,
    workspaceId,
    "access_group_memberships",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "group_id", type: "uuid" },
      { name: "member_id", type: "uuid" },
      { name: "created_at", type: "timestamptz" },
    ],
    memberIds.length,
    batchSize,
    (index) => {
      const when = at(index, memberIds.length);
      return [
        newId(when),
        workspaceId,
        anchors.workspaceStandardGroupId,
        memberIds[index] as string,
        new Date(when),
      ];
    },
  );
  report("access_group_memberships", memberIds.length, step);

  // --- Spaces --------------------------------------------------------------
  // The workspace already owns one from provisioning. The rest are added here
  // so a space filter is selective; each gets its own context and its
  // `space_standard` group, which is what a goal's edit binding resolves
  // through.
  step = Date.now();
  const extraSpaces = Math.max(counts.spaces - anchors.spaceIds.length, 0);
  const newSpaceIds: string[] = [];
  await insertGenerated(
    pool,
    workspaceId,
    "spaces",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "name", type: "text" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    extraSpaces,
    batchSize,
    (index) => {
      const when = at(index, Math.max(extraSpaces, 1));
      const id = newId(when);
      newSpaceIds.push(id);
      return [
        id,
        workspaceId,
        `Space ${index + 2}`,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("spaces", newSpaceIds.length, step);

  const spaceIds = [...anchors.spaceIds, ...newSpaceIds];
  const spaceGroupIds = new Map<string, string>();
  await inTenantTransaction(pool, workspaceId, async (client) => {
    // The provisioned space already has its group; read it rather than
    // making a second one.
    const existing = await client.query<{ id: string; space_id: string }>(
      "select id, space_id from access_groups where workspace_id = $1 and kind = 'space_standard' and deleted_at is null",
      [workspaceId],
    );
    for (const row of existing.rows) {
      spaceGroupIds.set(row.space_id, row.id);
    }
  });

  step = Date.now();
  const spacesNeedingGroups = spaceIds.filter((id) => !spaceGroupIds.has(id));
  await insertGenerated(
    pool,
    workspaceId,
    "access_groups",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "kind", type: "text" },
      { name: "space_id", type: "uuid" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    spacesNeedingGroups.length,
    batchSize,
    (index) => {
      const spaceId = spacesNeedingGroups[index] as string;
      const when = at(index, Math.max(spacesNeedingGroups.length, 1));
      const id = newId(when);
      spaceGroupIds.set(spaceId, id);
      return [
        id,
        workspaceId,
        "space_standard",
        spaceId,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("space_groups", spacesNeedingGroups.length, step);

  // --- Goals, their contexts and their four bindings each ------------------
  // Generated together so a goal and its access rows share one index, and
  // inserted table by table because `unnest` writes one table per statement.
  step = Date.now();
  const goalIds: string[] = new Array(counts.goals);
  const goalContextIds: string[] = new Array(counts.goals);
  const goalSpaceIds: string[] = new Array(counts.goals);
  const goalChampionIds: string[] = new Array(counts.goals);
  const goalReviewerIds: string[] = new Array(counts.goals);

  await insertGenerated(
    pool,
    workspaceId,
    "goals",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "title", type: "text" },
      { name: "cycle_id", type: "uuid" },
      { name: "level", type: "text" },
      { name: "owner_kind", type: "text" },
      { name: "space_id", type: "uuid" },
      { name: "champion_id", type: "uuid" },
      { name: "reviewer_id", type: "uuid" },
      { name: "health", type: "text" },
      { name: "progress_pct", type: "numeric" },
      { name: "position", type: "int4" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    counts.goals,
    batchSize,
    (index) => {
      const when = at(index, counts.goals);
      const id = newId(when);
      const spaceId = spaceIds[index % spaceIds.length] as string;
      const championId = memberIds[index % memberIds.length] as string;
      const reviewerId = memberIds[(index + 7) % memberIds.length] as string;
      goalIds[index] = id;
      goalContextIds[index] = newId(when);
      goalSpaceIds[index] = spaceId;
      goalChampionIds[index] = championId;
      goalReviewerIds[index] = reviewerId;
      return [
        id,
        workspaceId,
        `Objective ${index + 1}`,
        anchors.cycleId,
        pick(LEVELS, random),
        "space",
        spaceId,
        championId,
        reviewerId,
        pick(HEALTH, random),
        String(Math.floor(random() * 100)),
        index % 50,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("goals", counts.goals, step);

  step = Date.now();
  await insertGenerated(
    pool,
    workspaceId,
    "access_contexts",
    CONTEXT_COLUMNS,
    counts.goals,
    batchSize,
    (index) => {
      const when = at(index, counts.goals);
      return [
        goalContextIds[index] as string,
        workspaceId,
        "goal",
        goalIds[index] as string,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("access_contexts", counts.goals, step);

  // Four per goal, in the order `goals/service.ts` writes them: everyone can
  // read it, the owning space can edit it, the champion holds it, the
  // reviewer can close the loop.
  step = Date.now();
  const bindingsPerGoal = 4;
  await insertGenerated(
    pool,
    workspaceId,
    "access_bindings",
    BINDING_COLUMNS,
    counts.goals * bindingsPerGoal,
    batchSize,
    (index) => {
      const goalIndex = Math.floor(index / bindingsPerGoal);
      const slot = index % bindingsPerGoal;
      const when = at(goalIndex, counts.goals);
      const contextId = goalContextIds[goalIndex] as string;
      const base = [newId(when), workspaceId] as const;
      if (slot === 0) {
        return [
          ...base,
          anchors.workspaceStandardGroupId,
          contextId,
          ACCESS_LEVELS.view,
          null,
          new Date(when),
        ];
      }
      if (slot === 1) {
        return [
          ...base,
          spaceGroupIds.get(goalSpaceIds[goalIndex] as string) as string,
          contextId,
          ACCESS_LEVELS.edit,
          null,
          new Date(when),
        ];
      }
      if (slot === 2) {
        return [
          ...base,
          memberGroupIds.get(goalChampionIds[goalIndex] as string) as string,
          contextId,
          ACCESS_LEVELS.full,
          "champion",
          new Date(when),
        ];
      }
      return [
        ...base,
        memberGroupIds.get(goalReviewerIds[goalIndex] as string) as string,
        contextId,
        ACCESS_LEVELS.edit,
        "reviewer",
        new Date(when),
      ];
    },
  );
  report("access_bindings", counts.goals * bindingsPerGoal, step);

  // --- Key results ---------------------------------------------------------
  step = Date.now();
  const keyResultIds: string[] = new Array(counts.keyResults);
  await insertGenerated(
    pool,
    workspaceId,
    "key_results",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "goal_id", type: "uuid" },
      { name: "title", type: "text" },
      { name: "direction", type: "text" },
      { name: "indicator_type", type: "text" },
      { name: "baseline_value", type: "numeric" },
      { name: "target_value", type: "numeric" },
      { name: "current_value", type: "numeric" },
      { name: "owner_id", type: "uuid" },
      { name: "progress_pct", type: "numeric" },
      { name: "position", type: "int4" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    counts.keyResults,
    batchSize,
    (index) => {
      const when = at(index, counts.keyResults);
      const id = newId(when);
      keyResultIds[index] = id;
      const current = Math.floor(random() * 100);
      return [
        id,
        workspaceId,
        goalIds[index % counts.goals] as string,
        `Key result ${index + 1}`,
        pick(DIRECTIONS, random),
        pick(INDICATORS, random),
        "0",
        "100",
        String(current),
        memberIds[index % memberIds.length] as string,
        String(current),
        index % 5,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("key_results", counts.keyResults, step);

  // --- Initiatives ---------------------------------------------------------
  step = Date.now();
  const initiativeIds: string[] = new Array(counts.initiatives);
  await insertGenerated(
    pool,
    workspaceId,
    "initiatives",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "space_id", type: "uuid" },
      { name: "title", type: "text" },
      { name: "owner_id", type: "uuid" },
      { name: "status", type: "text" },
      { name: "progress_pct", type: "numeric" },
      { name: "position", type: "int4" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    counts.initiatives,
    batchSize,
    (index) => {
      const when = at(index, counts.initiatives);
      const id = newId(when);
      initiativeIds[index] = id;
      return [
        id,
        workspaceId,
        spaceIds[index % spaceIds.length] as string,
        `Initiative ${index + 1}`,
        memberIds[index % memberIds.length] as string,
        pick(INITIATIVE_STATUS, random),
        String(Math.floor(random() * 100)),
        index % 20,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("initiatives", counts.initiatives, step);

  // --- Tasks ---------------------------------------------------------------
  // The million. Most belong to an initiative and about half also name the key
  // result they move, which is the join the board and the initiative page both
  // walk.
  step = Date.now();
  await insertGenerated(
    pool,
    workspaceId,
    "tasks",
    [
      { name: "id", type: "uuid" },
      { name: "workspace_id", type: "uuid" },
      { name: "space_id", type: "uuid" },
      { name: "initiative_id", type: "uuid" },
      { name: "key_result_id", type: "uuid" },
      { name: "title", type: "text" },
      { name: "status", type: "text" },
      { name: "position", type: "int4" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" },
    ],
    counts.tasks,
    batchSize,
    (index) => {
      const when = at(index, counts.tasks);
      return [
        newId(when),
        workspaceId,
        spaceIds[index % spaceIds.length] as string,
        counts.initiatives > 0
          ? (initiativeIds[index % counts.initiatives] as string)
          : null,
        index % 2 === 0 && counts.keyResults > 0
          ? (keyResultIds[index % counts.keyResults] as string)
          : null,
        `Task ${index + 1}`,
        pick(TASK_STATUS, random),
        index % 100,
        new Date(when),
        new Date(when),
      ];
    },
  );
  report("tasks", counts.tasks, step);

  return { rows, seconds: (Date.now() - started) / 1000 };
}
