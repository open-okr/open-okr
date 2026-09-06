/**
 * The demo workspace builder (IMPLEMENTATION-PLAN P3-T17, screen S-34).
 *
 * Fills a real workspace with a believable organisation running a real quarter,
 * so a demo shows the product working rather than the product empty. Read
 * `cast.ts`, `okrs.ts` and `metrics.ts` for the story; this file is the
 * machinery that writes it.
 *
 * Three rules it does not bend:
 *
 * 1. **Everything goes through the action registry.** No shortcut inserts. A
 *    demo goal gets the same access bindings, activity row, audit row and
 *    outbox row a real one gets, so what you show is what the product does.
 *    The one exception is creating members, which has no action yet: that runs
 *    through `runOperation` directly, which is the same pipeline.
 * 2. **It never works around a rule the product enforces.** A check-in is
 *    acknowledged only where the person running the seed is the reviewer of
 *    record, because METHOD.md §6.5 lets nobody else close that loop. Where a
 *    rule leaves something impossible to seed, the seed leaves it undone and
 *    the result says so.
 * 3. **Idempotent.** Run it twice and the second run reports that the demo is
 *    already there rather than building a second copy.
 *
 * What it deliberately cannot do, and why:
 *
 * - **Demo people cannot sign in.** They are members with no user account.
 *   Registration closes once an instance is claimed (TECHNICAL-PLAN §4.14) and
 *   inventing sign-in credentials would mean working around that. They own
 *   goals, champion and review them, hold space roles and appear in the org
 *   chart; they just have nobody behind them.
 * - **Every write is authored by the person running the seed**, for the same
 *   reason: an action resolves its author from the acting user. So the audit
 *   trail and the feed name you, honestly, rather than naming Priya for
 *   something Priya did not do.
 * - **Key results carry one reading each, not a series.** `goals.recordValue`
 *   takes no timestamp, so a seeded series lands milliseconds apart and §3.6's
 *   forecast fits a near-vertical line through it. One reading leaves the
 *   forecast honestly silent instead. The full reasoning, and the defect it
 *   works around, are at the top of `okrs.ts`. KPI readings are different:
 *   `kpis.record` takes the period date, so those charts are real six-month
 *   trends.
 * - **The scorecard stays empty.** It reads `key_results.score`, and scoring at
 *   the quarterly review is P4-T10. There is nothing to seed yet, and seeding
 *   invented scores would put a number on a screen that no review agreed.
 */
import { newId, workspaceMembers } from "@openokr/db";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import { runOperation } from "../operations/operation.ts";
import { richTextFromPlainText } from "../rich-text/from-text.ts";
import {
  BASELINE_HEALTH,
  CAPACITY_CUTS,
  type CastKey,
  FRAME,
  INVENTED_CAST,
  ISSUES,
  PRIORITIES,
  REVALIDATION,
  SPACES,
  type SpaceKey,
} from "./cast.ts";
import {
  KPI_CATEGORIES,
  KPI_TREES,
  KPIS,
  type KpiKey,
  RECOVERY_KPI_KEY,
} from "./metrics.ts";
import {
  DISCUSSION,
  GOAL_DEPENDENCIES,
  GOALS,
  type GoalKey,
  KEY_RESULT_DEPENDENCIES,
  VOTES,
} from "./okrs.ts";

export interface DemoContext {
  readonly pool: Pool;
  readonly workspaceId: string;
  /**
   * The userId of the person who owns this workspace. Every write is made as
   * them, because an action resolves its author from the acting user and there
   * is no other real user on the instance.
   */
  readonly adminUserId: string;
}

type Ctx = ReturnType<typeof contextFor>;

function contextFor(demo: DemoContext) {
  return {
    pool: demo.pool,
    workspaceId: demo.workspaceId,
    actor: { kind: "human" as const, userId: demo.adminUserId },
  };
}

export interface BuildDemoResult {
  readonly alreadySeeded: boolean;
  readonly membersCreated: number;
  readonly spacesCreated: number;
  readonly goalsCreated: number;
  readonly keyResultsCreated: number;
  readonly checkInsPublished: number;
  readonly kpisCreated: number;
  readonly kpiRecordsWritten: number;
  /**
   * Things the seed could not do and the reason, in words a presenter can
   * repeat. Printed by `pnpm db:seed` so nobody discovers them on stage.
   */
  readonly notes: readonly string[];
}

const EMPTY: BuildDemoResult = {
  alreadySeeded: true,
  membersCreated: 0,
  spacesCreated: 0,
  goalsCreated: 0,
  keyResultsCreated: 0,
  checkInsPublished: 0,
  kpisCreated: 0,
  kpiRecordsWritten: 0,
  notes: [],
};

// ── Dates ───────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` in UTC. Good enough for a seed; the product reads timezones. */
const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (from: string, days: number): string => {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
};

/** The first day of the month `back` months before the month containing `now`. */
const monthStart = (now: Date, back: number): string => {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1),
  );
  return isoDate(date);
};

/** The next weekday on or after a date, so a booked session is not a Sunday. */
const nextWeekday = (from: string): string => {
  let cursor = from;
  for (let i = 0; i < 7; i++) {
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    if (day !== 0 && day !== 6) {
      return cursor;
    }
    cursor = addDays(cursor, 1);
  }
  return cursor;
};

// ── Chapters ────────────────────────────────────────────────────────────

/**
 * The cast, as members with no user account behind them.
 *
 * There is no `members.create` action: a member arrives by accepting an
 * invitation, and an invitation needs somebody to accept it. So this runs the
 * Operation pipeline directly, the same way workspace provisioning writes its
 * founding member. Nothing about the row is special — `workspace_standard`
 * reaches every active human member by definition, so no extra binding is
 * needed for them to be seen, owned to, championed by or reported to.
 */
async function createCast(
  demo: DemoContext,
  context: Ctx,
): Promise<Map<CastKey, string>> {
  const byKey = new Map<CastKey, string>();

  // The founding member is the person running the demo. They keep their name.
  const directory = await callAction(context, "people.directory", {});
  const founder = directory[0];
  if (!founder) {
    throw new Error("The workspace has no members. Run the wizard first.");
  }
  byKey.set("admin", founder.id);

  for (const person of INVENTED_CAST) {
    const memberId = await runOperation(
      { pool: demo.pool },
      {
        action: "demo.createMember",
        workspaceId: demo.workspaceId,
        actor: { kind: "human", userId: demo.adminUserId },
        async execute({ tx, workspaceId }) {
          const id = newId();
          await tx.insert(workspaceMembers).values({
            id,
            workspaceId,
            // No user account, on purpose. See the note at the top of the file.
            userId: null,
            name: person.name,
            title: person.title,
            timezone: person.timezone,
            kind: "human",
            status: "active",
          });
          return {
            result: id,
            activity: {
              kind: "member.updated" as const,
              subjectType: "member" as const,
              subjectId: id,
              payload: { name: person.name },
            },
            audit: {
              action: "demo.createMember",
              targetType: "member",
              targetId: id,
              payload: { name: person.name, title: person.title },
            },
          };
        },
      },
    );
    byKey.set(person.key, memberId);
  }

  // The manager chain, once every member exists. Done as a second pass because
  // a manager has to be there before anybody can point at them.
  for (const person of INVENTED_CAST) {
    const memberId = byKey.get(person.key);
    const managerId = person.managerKey
      ? byKey.get(person.managerKey)
      : undefined;
    if (memberId && managerId) {
      await callAction(context, "people.updateMember", {
        memberId,
        managerId,
      });
    }
  }

  // The founder's own title, so the org chart has a root that reads as one.
  await callAction(context, "people.updateMember", {
    memberId: founder.id,
    title: "Chief Executive",
  });

  return byKey;
}

/**
 * Four spaces beyond the default one, with managers, coordinators and members.
 *
 * The person running the demo joins all four. Not decoration: a space-owned
 * goal binds `space_standard` at edit and `workspace_standard` at view only, so
 * without membership the seeder could create a goal in Engineering and then be
 * refused when it tried to add a key result to it. Their own access is the
 * thing that makes the rest of this file possible, and it is worth knowing that
 * during a demo, because it is the access model doing exactly what it says.
 */
async function createSpaces(
  context: Ctx,
  cast: Map<CastKey, string>,
): Promise<Map<SpaceKey, string>> {
  const byKey = new Map<SpaceKey, string>();
  const founderId = cast.get("admin");

  for (const space of SPACES) {
    const managerId = cast.get(space.managerKey);
    const created = await callAction(context, "spaces.create", {
      name: space.name,
      mission: space.mission,
      ...(managerId ? { managerMemberId: managerId } : {}),
    });
    byKey.set(space.key, created.id);

    for (const key of space.memberKeys) {
      const memberId = cast.get(key);
      if (!memberId || memberId === managerId) {
        continue;
      }
      await callAction(context, "spaces.addMember", {
        spaceId: created.id,
        memberId,
        role: key === space.coordinatorKey ? "coordinator" : "member",
      });
    }

    // The coordinator, where they are also the manager, is already covered:
    // METHOD.md §2.5 lets one person hold both and the manager's own binding is
    // the stronger of the two.
    if (space.coordinatorKey !== space.managerKey) {
      const coordinatorId = cast.get(space.coordinatorKey);
      if (coordinatorId) {
        await callAction(context, "spaces.setMemberRole", {
          spaceId: created.id,
          memberId: coordinatorId,
          role: "coordinator",
        });
      }
    }

    if (
      founderId &&
      !space.memberKeys.includes("admin") &&
      founderId !== managerId
    ) {
      await callAction(context, "spaces.addMember", {
        spaceId: created.id,
        memberId: founderId,
        role: "member",
      });
    }
  }

  return byKey;
}

/** The annual frame: the year, the horizon, and three strategies (§2.1). */
async function setFrame(context: Ctx): Promise<void> {
  await callAction(context, "frame.set", {
    yearLabel: FRAME.yearLabel,
    horizonLabel: FRAME.horizonLabel,
    agreed: FRAME.agreed,
    strategies: FRAME.strategies.map((strategy) => ({
      text: strategy.text,
      note: strategy.note,
    })),
  });
}

interface CycleFacts {
  readonly id: string;
  readonly startsOn: string;
}

/**
 * The quarter's own workflow, phase by phase (METHOD.md §2.2 to §2.6).
 *
 * Everything a phase panel reads is filled in, so the rail shows real
 * completion rather than an empty scaffold. Phase 1's pack lead is the one
 * date that has to be arranged rather than stated: `workflow.distributePack`
 * stamps the distribution as now, so session one is booked far enough ahead
 * that the §2.6 lead time is genuinely met instead of asserted.
 */
async function runCycleWorkflow(
  context: Ctx,
  cast: Map<CastKey, string>,
  now: Date,
): Promise<CycleFacts> {
  const cycle = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });
  if (!cycle) {
    throw new Error("No current cycle. Provisioning should have created one.");
  }

  const sponsorId = cast.get("admin");
  const facilitatorId = cast.get("priya");

  // Session one is booked comfortably clear of today, because the pack is
  // distributed now and §2.6 asks for three working days between the two.
  const firstSession = nextWeekday(addDays(isoDate(now), 8));
  await callAction(context, "cycles.update", {
    id: cycle.id,
    ...(sponsorId ? { sponsorId } : {}),
    ...(facilitatorId ? { facilitatorId } : {}),
    // Gate 6 asks for a deadline before day one of the cycle, which is what a
    // set published on time looks like from the inside.
    publicationDeadline: addDays(cycle.startsOn, -3),
    // True on a fresh instance, and it is what lets phase 2 read honestly:
    // there is no prior cycle to score, rather than a prior cycle nobody
    // scored.
    firstCycle: true,
    levels: ["company", "department", "team", "individual"],
    // Phase 5, Align and commit, because that is where the work below actually
    // reaches: the set is drafted, capacity is checked and the gates are the
    // only thing left. The pointer is set by hand rather than inferred, which
    // is how the product works too — a facilitator moves it.
    phase: 5,
    sessionDates: [
      { key: "diagnose", on: firstSession },
      { key: "set-direction", on: nextWeekday(addDays(firstSession, 7)) },
      { key: "align-and-commit", on: nextWeekday(addDays(firstSession, 14)) },
    ],
  });

  // Phase 1: the seven §2.6 input-pack items, then distribution.
  for (let itemKey = 1; itemKey <= 7; itemKey++) {
    await callAction(context, "workflow.setPackItem", {
      cycleId: cycle.id,
      itemKey,
      gathered: true,
    });
  }
  await callAction(context, "workflow.distributePack", { cycleId: cycle.id });

  // Phase 2: the reading of the numbers, then the ranked issues.
  await callAction(context, "workflow.setBaselineHealth", {
    cycleId: cycle.id,
    stable: richTextFromPlainText(BASELINE_HEALTH.stable),
    declining: richTextFromPlainText(BASELINE_HEALTH.declining),
    businessAsUsual: richTextFromPlainText(BASELINE_HEALTH.businessAsUsual),
  });

  const issueIds = new Map<string, string>();
  for (const issue of ISSUES) {
    const created = await callAction(context, "workflow.addIssue", {
      cycleId: cycle.id,
      text: issue.text,
      impact: issue.impact,
      source: "manual",
    });
    issueIds.set(issue.key, created.id);
  }

  // Phase 3: two issues promoted into priorities, two deliberately not.
  for (const priority of PRIORITIES) {
    const fromIssueId = issueIds.get(priority.fromIssueKey);
    await callAction(context, "workflow.addPriority", {
      cycleId: cycle.id,
      text: priority.text,
      successStatement: priority.successStatement,
      ...(fromIssueId ? { fromIssueId } : {}),
    });
  }
  await callAction(context, "workflow.setRevalidation", {
    cycleId: cycle.id,
    holds: REVALIDATION.holds,
    changed: REVALIDATION.changed,
    focusNote: REVALIDATION.focusNote,
  });

  return { id: cycle.id, startsOn: cycle.startsOn };
}

/**
 * Phase 5's capacity note, written last on purpose.
 *
 * Publish gate 5 reads it, and §5.5 is explicit that an empty answer means
 * capacity was never checked. It runs after the set exists for a second reason
 * worth knowing: the six gate rows are a cache refreshed by workflow writes,
 * and a goal write does not refresh them. Writing this after the goals leaves
 * the stored rows agreeing with the set they describe. The `/cycle` screen and
 * `workflow.publish` both re-evaluate rather than trusting the cache, so this
 * is tidiness rather than correctness, but a seed that leaves a stale row
 * behind is a seed somebody will one day debug.
 */
async function recordCapacity(context: Ctx, cycleId: string): Promise<void> {
  await callAction(context, "workflow.setCapacityNotes", {
    cycleId,
    cuts: richTextFromPlainText(CAPACITY_CUTS),
  });
}

interface MetricsResult {
  readonly ids: Map<KpiKey, string>;
  readonly created: number;
  readonly records: number;
}

/**
 * The KPI layer: categories, eleven metrics, six months of readings, two driver
 * trees and one calculated metric.
 *
 * Readings are written oldest first on real month starts, so the period chart
 * on a KPI detail page draws a trend and the corridor bands have something to
 * cross. This is the one part of the seed with genuine history, because
 * `kpis.record` takes the period date and `goals.recordValue` does not.
 */
async function createMetrics(context: Ctx, now: Date): Promise<MetricsResult> {
  const categories = new Map<string, string>();
  for (const category of KPI_CATEGORIES) {
    const created = await callAction(context, "kpis.createCategory", {
      name: category.name,
    });
    categories.set(category.key, created.id);
  }

  const ids = new Map<KpiKey, string>();
  let records = 0;

  for (const kpi of KPIS) {
    const categoryId = categories.get(kpi.categoryKey);
    const parentId = kpi.parentKey ? ids.get(kpi.parentKey) : undefined;
    const created = await callAction(context, "kpis.create", {
      title: kpi.title,
      frequency: "monthly",
      direction: kpi.direction,
      indicatorType: kpi.indicatorType,
      tier: kpi.tier,
      aggregate: "avg",
      ownerKind: "workspace",
      ...(categoryId ? { categoryId } : {}),
      ...(parentId ? { parentKpiId: parentId } : {}),
      ...(kpi.unit ? { unit: kpi.unit } : {}),
      targetDefault: kpi.targetDefault,
      healthyPct: kpi.healthyPct,
      watchPct: kpi.watchPct,
    });
    ids.set(kpi.key, created.id);

    // Six months of readings, oldest first, on real month starts.
    const values = kpi.records ?? [];
    for (const [index, value] of values.entries()) {
      await callAction(context, "kpis.record", {
        kpiId: created.id,
        on: monthStart(now, values.length - 1 - index),
        actualValue: value,
        targetValue: kpi.targetDefault,
      });
      records += 1;
    }
  }

  // The calculated metric, once every source exists. Its value is evaluated for
  // the current month from the sources' own readings.
  for (const kpi of KPIS) {
    if (!kpi.formula) {
      continue;
    }
    const kpiId = ids.get(kpi.key);
    const left = ids.get(kpi.formula.left);
    const right = ids.get(kpi.formula.right);
    if (!(kpiId && left && right)) {
      continue;
    }
    await callAction(context, "kpis.setFormula", {
      kpiId,
      formula: { op: kpi.formula.op, l: { k: left }, r: { k: right } },
      on: monthStart(now, 0),
    });
  }

  // The two driver trees, then every descendant filed into the one its root
  // names. A tree is a row that names a root, and the parent chain is what
  // shapes it, so filing is a separate act from parenting: a KPI can hang off
  // another KPI and belong to no tree, which is what the two metrics below
  // with no parent do. Walking up the chain here rather than repeating the
  // tree name on every metric keeps one fact in one place.
  const treeIds = new Map<KpiKey, string>();
  for (const tree of KPI_TREES) {
    const rootKpiId = ids.get(tree.rootKey);
    const created = await callAction(context, "kpis.createTree", {
      name: tree.name,
      ...(rootKpiId ? { rootKpiId } : {}),
    });
    treeIds.set(tree.rootKey, created.id);
  }

  const parentOf = new Map<KpiKey, KpiKey | undefined>(
    KPIS.map((kpi) => [kpi.key, kpi.parentKey]),
  );
  const rootOf = (key: KpiKey): KpiKey => {
    let cursor = key;
    // Bounded by the metric count: the update action refuses a cycle, so the
    // chain cannot loop, and this stays a walk rather than a trust exercise.
    for (let step = 0; step < KPIS.length; step++) {
      const parent = parentOf.get(cursor);
      if (!parent) {
        return cursor;
      }
      cursor = parent;
    }
    return cursor;
  };

  for (const kpi of KPIS) {
    if (!kpi.parentKey) {
      continue;
    }
    const kpiId = ids.get(kpi.key);
    const treeId = treeIds.get(rootOf(kpi.key));
    if (kpiId && treeId) {
      await callAction(context, "kpis.update", { kpiId, treeId });
    }
  }

  return { ids, created: KPIS.length, records };
}

interface OkrResult {
  readonly goals: Map<GoalKey, string>;
  readonly keyResults: Map<string, string>;
  readonly checkInsPublished: number;
}

/**
 * The quarter's set: seven objectives, their key results, their history, the
 * dependency register, the check-ins and the confidence votes.
 *
 * Written parent-first, because `GOALS` is ordered so a parent always precedes
 * its children and `goals.create` refuses a parent it cannot see.
 */
async function createOkrs(
  context: Ctx,
  cast: Map<CastKey, string>,
  spaces: Map<SpaceKey, string>,
  kpis: Map<KpiKey, string>,
  cycleId: string,
): Promise<OkrResult> {
  const goalIds = new Map<GoalKey, string>();
  const keyResultIds = new Map<string, string>();
  let checkInsPublished = 0;

  for (const goal of GOALS) {
    const championId = cast.get(goal.championKey);
    const reviewerId = cast.get(goal.reviewerKey);
    if (!(championId && reviewerId)) {
      throw new Error(
        `Demo goal "${goal.key}" names a member that is missing.`,
      );
    }
    const spaceId = goal.spaceKey ? spaces.get(goal.spaceKey) : undefined;
    const memberId = goal.memberKey ? cast.get(goal.memberKey) : undefined;
    const parentGoalId = goal.parentKey
      ? goalIds.get(goal.parentKey)
      : undefined;

    const created = await callAction(context, "goals.create", {
      title: goal.title,
      description: richTextFromPlainText(goal.description),
      cycleId,
      level: goal.level,
      ownerKind: goal.ownerKind,
      ...(spaceId ? { spaceId } : {}),
      ...(memberId ? { memberId } : {}),
      championId,
      reviewerId,
      ...(parentGoalId ? { parentGoalId } : {}),
      weight: goal.weight ?? 1,
      ...(goal.contributionStatement
        ? { contributionStatement: goal.contributionStatement }
        : {}),
    });
    goalIds.set(goal.key, created.id);

    for (const keyResult of goal.keyResults) {
      const ownerId = keyResult.ownerKey
        ? cast.get(keyResult.ownerKey)
        : undefined;
      const kpiId = keyResult.kpiKey
        ? kpis.get(keyResult.kpiKey as KpiKey)
        : undefined;
      const addedKeyResult = await callAction(context, "goals.addKeyResult", {
        goalId: created.id,
        title: keyResult.title,
        ...(keyResult.unit ? { unit: keyResult.unit } : {}),
        direction: keyResult.direction,
        indicatorType: keyResult.indicatorType,
        baselineValue: keyResult.baselineValue,
        targetValue: keyResult.targetValue,
        weight: keyResult.weight ?? 1,
        ...(ownerId ? { ownerId } : {}),
        ...(keyResult.capacity ? { capacity: keyResult.capacity } : {}),
        ...(kpiId ? { kpiId } : {}),
        // Where the measure stands, written as part of creation rather than as
        // a second `goals.recordValue`. That leaves exactly one point in the
        // value window, which is what keeps §3.6's forecast quiet instead of
        // fitting a near-vertical line through readings milliseconds apart.
        // The reason is set out in full at the top of `okrs.ts`.
        ...(kpiId || keyResult.current === undefined
          ? {}
          : { currentValue: keyResult.current }),
      });
      keyResultIds.set(keyResult.key, addedKeyResult.id);
    }
  }

  // The dependency register (§5.4), after every goal and key result exists.
  for (const dependency of GOAL_DEPENDENCIES) {
    const fromGoalId = goalIds.get(dependency.fromKey);
    const toGoalId = goalIds.get(dependency.toKey);
    if (fromGoalId && toGoalId) {
      await callAction(context, "goals.addDependency", {
        fromGoalId,
        toGoalId,
        note: dependency.note,
      });
    }
  }

  for (const dependency of KEY_RESULT_DEPENDENCIES) {
    const keyResultId = keyResultIds.get(dependency.keyResultKey);
    if (!keyResultId) {
      continue;
    }
    const providerSpaceId = dependency.providerSpaceKey
      ? spaces.get(dependency.providerSpaceKey)
      : undefined;
    const riskOwnerId = dependency.riskOwnerKey
      ? cast.get(dependency.riskOwnerKey)
      : undefined;
    const added = await callAction(context, "goals.addKeyResultDependency", {
      keyResultId,
      ...(providerSpaceId ? { providerSpaceId } : {}),
      ...(dependency.providerText
        ? { providerText: dependency.providerText }
        : {}),
      note: dependency.note,
      ...(riskOwnerId ? { riskOwnerId } : {}),
    });
    if (dependency.confirm) {
      await callAction(context, "goals.confirmDependency", { id: added.id });
    }
  }

  // Check-ins, in the order the story tells them.
  for (const goal of GOALS) {
    const goalId = goalIds.get(goal.key);
    if (!goalId) {
      continue;
    }
    for (const checkIn of goal.checkIns ?? []) {
      const draft = await callAction(context, "goals.startCheckIn", { goalId });
      const published = await callAction(context, "goals.publishCheckIn", {
        id: draft.id,
        status: checkIn.status,
        confidence: checkIn.confidence,
        narrative: richTextFromPlainText(checkIn.narrative),
        // No values moved here, for the reason at the top of `okrs.ts`: the
        // figures are already on the key results and a second write would be a
        // second point in the forecast window a millisecond after the first.
        values: [],
      });
      checkInsPublished += 1;
      if (checkIn.acknowledge) {
        await callAction(context, "goals.acknowledgeCheckIn", {
          id: published.id,
        });
      }
    }
    if (goal.openDraft) {
      await callAction(context, "goals.startCheckIn", { goalId });
    }
  }

  // The confidence round (§7.2): one private vote each, one of them revealed.
  for (const vote of VOTES) {
    const keyResultId = keyResultIds.get(vote.keyResultKey);
    if (!keyResultId) {
      continue;
    }
    await callAction(context, "goals.vote", {
      keyResultId,
      confidence: vote.confidence,
    });
    if (vote.reveal) {
      await callAction(context, "goals.revealVotes", { keyResultId });
    }
  }

  return { goals: goalIds, keyResults: keyResultIds, checkInsPublished };
}

/**
 * The recovery objective (METHOD.md §6.5).
 *
 * Launched rather than written: `kpis.launchRecovery` walks the unhealthy
 * branch of the tree breadth-first and turns the leading drivers at its edge
 * into key results. Seeding the objective by hand would show a goal; launching
 * it shows the engine that produced the goal.
 *
 * **The contribution statement is added afterwards, and that is not cosmetic.**
 * `launchRecoveryInTx` creates the objective with no parent and no contribution
 * statement, so publish gate 3, "each objective states what it contributes to",
 * turns red the moment a recovery is launched and the set can no longer be
 * published. A facilitator would answer the gate by writing the sentence, which
 * is what this does. It is worth raising as a defect rather than only working
 * around here: the launcher should write it.
 */
async function launchRecovery(
  context: Ctx,
  kpis: Map<KpiKey, string>,
  cycleId: string,
): Promise<boolean> {
  const kpiId = kpis.get(RECOVERY_KPI_KEY);
  if (!kpiId) {
    return false;
  }
  const launched = await callAction(context, "kpis.launchRecovery", {
    kpiId,
    cycleId,
  });
  await callAction(context, "goals.update", {
    id: launched.goalId,
    contributionStatement:
      "Recovers Operating margin to its corridor. It contributes to the annual thrust on cost rather than to a quarterly objective, which is why it has no parent.",
    // **A second defect, and the same shape as the first.**
    // `launchRecoveryInTx` calls `createGoalInTx` without `stampFirstDue`, so a
    // launched recovery objective has no next check-in date at all: it never
    // becomes due, never reaches anybody's review inbox, and never goes stale.
    // On the objective most in need of a rhythm, that is the wrong way round.
    // Passing the frequency through re-stamps it along the product's own path;
    // `null` means "use the workspace default", so nothing about the cadence
    // changes, only that it now has one.
    checkInFrequency: null,
  });
  return true;
}

/** Comments and reactions, so a goal's discussion rail has something in it. */
async function seedDiscussion(
  context: Ctx,
  goals: Map<GoalKey, string>,
): Promise<void> {
  for (const entry of DISCUSSION) {
    const goalId = goals.get(entry.goalKey);
    if (!goalId) {
      continue;
    }
    await callAction(context, "comments.create", {
      subjectType: "goal",
      subjectId: goalId,
      body: richTextFromPlainText(entry.body),
    });
    for (const emoji of entry.reactions ?? []) {
      await callAction(context, "reactions.add", {
        subjectType: "goal",
        subjectId: goalId,
        emoji,
      });
    }
    // Following the goal, so the notification spine has a real subscriber and
    // the next check-in on it produces a real notification.
    await callAction(context, "subscriptions.toggle", {
      subjectType: "goal",
      subjectId: goalId,
      subscribe: true,
    });
  }
}

// ── Entry point ─────────────────────────────────────────────────────────

export async function buildDemoWorkspace(
  demo: DemoContext,
): Promise<BuildDemoResult> {
  const context = contextFor(demo);
  const now = new Date();

  // Idempotency. Company objectives are the thing this builder always writes
  // and nothing else creates on a fresh workspace, so their presence is the
  // honest test for "already built".
  const existing = await callAction(context, "goals.list", {
    includeClosed: true,
    level: "company",
  });
  if (existing.goals.length > 0) {
    return EMPTY;
  }

  const cast = await createCast(demo, context);
  const spaces = await createSpaces(context, cast);
  await setFrame(context);
  const cycle = await runCycleWorkflow(context, cast, now);
  const metrics = await createMetrics(context, now);
  const okrs = await createOkrs(context, cast, spaces, metrics.ids, cycle.id);
  const recoveryLaunched = await launchRecovery(context, metrics.ids, cycle.id);
  await seedDiscussion(context, okrs.goals);
  await recordCapacity(context, cycle.id);

  const notes = [
    "The demo people have no user accounts, so nobody can sign in as them. Registration closes once an instance is claimed, and inventing credentials would work around that rule rather than demonstrate it.",
    "Every row was written by you, so the audit trail and the activity feed name you rather than naming Priya for something Priya did not do.",
    "Key result history is stamped now; the note on each value carries the week it belongs to. KPI readings are real month starts, so the KPI charts are genuine six-month trends.",
    "The set is not published, and publish gate 5 says why: one key result is still marked as exceeding capacity. Change it to tight on the goal page and watch the gate turn green.",
    "Publish gate 2 cannot be evaluated at all, because the §4 quality engine arrives at P4-T01. A gate that cannot check anything must not pass, so it blocks publication like a red one.",
    "The scorecard is empty. It reads key result scores, and scoring at the quarterly review is P4-T10. Seeding invented scores would put a number on screen that no review agreed.",
  ];
  if (recoveryLaunched) {
    notes.push(
      "The recovery objective under Operating margin was launched by the §6.5 engine, not written by hand. Its key results are the leading drivers at the edge of the unhealthy branch.",
    );
  }

  return {
    alreadySeeded: false,
    membersCreated: INVENTED_CAST.length,
    spacesCreated: SPACES.length,
    goalsCreated: GOALS.length + (recoveryLaunched ? 1 : 0),
    keyResultsCreated: GOALS.reduce(
      (total, goal) => total + goal.keyResults.length,
      0,
    ),
    checkInsPublished: okrs.checkInsPublished,
    kpisCreated: metrics.created,
    kpiRecordsWritten: metrics.records,
    notes,
  };
}
