import { ACCESS_LEVELS, callAction, OperationError } from "@openokr/core";
import {
  ALIGNMENT_LEVEL_ORDER,
  defaultOkrKind,
  resolveThresholds as defaultThresholds,
  okrKindsInUse,
  type ResolvedPractice,
  type ResolvedThresholds,
} from "@openokr/method";
import {
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Chip,
  type MessageValues,
} from "@openokr/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { workspaceReaderLevel } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { progressCeiling } from "../../lib/ceilings.ts";
import { filterGoals, type OkrScope } from "../../lib/okr-tree/cache.ts";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { mapNodesFor } from "../goal-nodes.ts";
import { exportListAction } from "../search/actions.ts";
import { ExportButton } from "../search/export-button.tsx";
import { MyExports } from "../search/my-exports.tsx";
import { GoalTable } from "../work-map.tsx";
import { CyclePicker } from "./cycle-picker.tsx";
import { filterAssistAvailableAction } from "./filter-actions.ts";
import { FilterAssist } from "./filter-assist.tsx";
import { FilterSelect } from "./filter-select.tsx";
import { NewObjectiveButton } from "./new-objective.tsx";
import { OkrDiagram } from "./okr-diagram.tsx";
import { OkrTable } from "./okr-table.tsx";
import { CYCLE_PLACEHOLDER, FILTER_PLACEHOLDER } from "./placeholders.ts";

/**
 * The goals explorer (UIUX-PLAN.md §4 S-13, P3-T10).
 *
 * Scope tabs, a cycle switcher, filters, and the set as either a flat list or a
 * tree indented by alignment. Everything is server-rendered from `goals.list`,
 * and every control is a link rather than client state, so a filtered view is a
 * URL somebody can send to the person who needs to see it.
 *
 * **Tree mode indents by the parent pointer, not by level.** Those two disagree
 * exactly where it matters: a team goal aligned straight to a company goal is a
 * level skip, and drawing it at team depth would hide the very thing the
 * alignment score penalises. A goal whose parent is outside the current filter
 * is drawn at the root with a note, rather than silently disappearing.
 */

type Goal = Awaited<
  ReturnType<typeof callAction<"goals.list">>
>["goals"][number];

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    cycle?: string;
    level?: string;
    view?: string;
    closed?: string;
    /**
     * §3.2's health band, and whose objectives these are (P4-T15d).
     *
     * Both are ordinary filters that work with no provider: the filter assist
     * needed them to exist before it could set them, and the explorer is better
     * for having them either way.
     */
    health?: string;
    mine?: string;
    /**
     * The scope tabs (P9-T07a-b): `team` is the spaces the reader belongs to
     * and `company` the company level. Mine keeps `mine=1`, which is what the
     * filter assist has always written, and All is neither.
     */
    scope?: string;
    /** One champion's objectives, and one space's. */
    champion?: string;
    space?: string;
    /** Committed or aspirational objectives only (METHOD.md §2.8, P9-T11b-a). */
    kind?: string;
    /** `objective` when the topbar's `+ New` sent the reader here. */
    new?: string;
    /**
     * The objective open in the drawer (P9-T08a). The drawer reads it, and
     * the tab and key result beside it, in the browser; the page reads it
     * only to choose the cycle a link names none of.
     */
    okr?: string;
    /**
     * Which of the three renderings is on screen (P8-G12).
     *
     * Separate from `view`, which has meant the tree-or-flat ordering since
     * P3-T10 and still does. `editor` is the editable set, `diagram` draws the
     * same cycle as a tree of cards, and `tree` is the Work Map's own table,
     * which is the only one of the three that indents by the parent pointer.
     */
    display?: string;
  }>;
}) {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  // A guest holds nothing here, and is moved to their spaces (L-23). The level
  // it resolves is also what decides which controls the editable set offers,
  // so it is kept rather than asked for a second time further down.
  const accessLevel = await workspaceReaderLevel(
    workspace.workspaceId,
    workspace.memberId,
  );
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const query = await searchParams;
  // Whether a provider can turn a sentence into filters. False is the normal
  // case, and the chips below are unchanged by it (P4-T15d).
  const filterAssistAvailable = await filterAssistAvailableAction();

  const cycles = await callAction(context, "cycles.list", {});
  const current = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });
  const cycleId =
    query.cycle ??
    (await drawerCycle(context, query.okr)) ??
    current?.id ??
    cycles[0]?.id ??
    null;

  // The levels this cycle offers (METHOD v2 §2.7, P9-T07a-c): the ones it
  // began with, plus any its objectives already use. The chips offer only
  // these, and a new objective is written at one of them, because the policy
  // refuses any other.
  const cycleLevels: readonly string[] = cycleId
    ? (await callAction(context, "cycles.levelsInUse", { cycleId })).levels
    : ALIGNMENT_LEVEL_ORDER;
  const level = ALIGNMENT_LEVEL_ORDER.find(
    (entry) => entry === query.level && cycleLevels.includes(entry),
  );
  const levelForNew = (level ??
    (cycleLevels.includes("team") ? "team" : (cycleLevels[0] ?? "team"))) as
    | "company"
    | "department"
    | "team"
    | "individual";
  // Validated against the band list rather than passed through, so a hand-edited
  // URL cannot ask for a band the product does not have.
  const health = GOAL_HEALTH_BANDS.find((entry) => entry === query.health);
  const mine = query.mine === "1";
  const scopeTab: "all" | "mine" | "team" | "company" = mine
    ? "mine"
    : query.scope === "team"
      ? "team"
      : query.scope === "company"
        ? "company"
        : "all";
  const includeClosed = query.closed === "1";
  const tree = query.view !== "list";
  const display =
    query.display === "diagram"
      ? "diagram"
      : query.display === "tree"
        ? "tree"
        : "editor";
  // Whether anything is narrowing the set. Derived rather than counted a second
  // time: the difference between "this cycle has no goals" and "your filters
  // left nothing" is knowable from the query alone, and getting it wrong is
  // what made the header claim an empty cycle that held two goals.
  // The champion and space choices are checked against the directory and the
  // spaces this reader can see, so a hand-edited address filters by nothing
  // rather than by an id the reader cannot see.
  const [directory, spaceRows] = await Promise.all([
    callAction(context, "people.directory", {}),
    callAction(context, "spaces.list", {}),
  ]);
  // People only: an agent or an unclaimed placeholder cannot champion an
  // objective or own a key result (H-09).
  const members = directory
    .filter((member) => member.kind === "human" || member.kind === "guest")
    .map((member) => ({ id: member.id, name: member.name }));
  const spaces = spaceRows.map((space) => ({ id: space.id, name: space.name }));
  const mySpaceIds = spaceRows
    .filter((space) => space.ownRole !== null)
    .map((space) => space.id);
  const champion = members.find((member) => member.id === query.champion)?.id;
  const space = spaces.find((entry) => entry.id === query.space)?.id;
  // Read whatever the display: the kind filter is offered only where the
  // workspace uses both kinds (METHOD.md §2.8).
  const practiceRead = await callAction(context, "practice.read", {});
  const kindsInUse = okrKindsInUse(practiceRead.practice as ResolvedPractice);
  const kind =
    kindsInUse.length > 1
      ? kindsInUse.find((entry) => entry === query.kind)
      : undefined;

  const filtered =
    level !== undefined ||
    health !== undefined ||
    scopeTab !== "all" ||
    includeClosed ||
    champion !== undefined ||
    space !== undefined ||
    kind !== undefined;

  // The list and the diagram draw from one tree, which the table's cache then
  // owns (P9-T06c); the indented tree view still reads `goals.list`. Only the
  // one the display needs is read. "Mine" on the tree is what the reader
  // champions, reviews or owns a key result under.
  const scope: OkrScope = mine ? "mine" : "all";
  const okrTree =
    cycleId && display !== "tree"
      ? await callAction(context, "goals.tree", {
          cycleId,
          scope,
          includeClosed: true,
        })
      : null;
  const treeReadAt = Date.now();
  // Company is the company level, whatever the level chips say; My team is
  // the reader's spaces. Both narrow the tree the same way the cache does.
  const levelInForce = scopeTab === "company" ? "company" : level;
  const filters = {
    level: levelInForce,
    health,
    includeClosed,
    championId: champion,
    spaceId: space,
    spaceIds: scopeTab === "team" ? mySpaceIds : undefined,
    kind,
  };
  const treeGoals = okrTree ? filterGoals(okrTree.goals, filters) : [];

  const listed =
    cycleId && display === "tree"
      ? await callAction(context, "goals.list", {
          cycleId,
          includeClosed,
          ...(levelInForce ? { level: levelInForce } : {}),
          ...(health ? { health } : {}),
          ...(mine ? { mine } : {}),
          ...(space ? { spaceId: space } : {}),
        })
      : { goals: [] };
  // `goals.list` has no champion or "my spaces" filter of its own, so those
  // two narrow its answer here, as the cache narrows the tree.
  const goals = listed.goals.filter(
    (goal) =>
      (champion === undefined || goal.champion.id === champion) &&
      (kind === undefined || goal.kind === kind) &&
      (scopeTab !== "team" ||
        (goal.spaceId !== null && mySpaceIds.includes(goal.spaceId))),
  );
  const shownCount = display === "tree" ? goals.length : treeGoals.length;
  const summary = summarise(
    display === "tree"
      ? goals.map((goal) => ({
          progressPct: goal.progressPct,
          health: goal.health,
          keyResults: goal.keyResults.length,
        }))
      : treeGoals.map((goal) => ({
          progressPct: goal.progressPct,
          health: goal.health,
          keyResults: goal.keyResults.length,
        })),
  );

  // What the editable list needs beyond the tree: who can champion or own,
  // and the numbers and practice its coaching chips judge by, which the
  // browser cannot read for itself (P9-T07a-a). Read for the list and for
  // the diagram, whose drawer edits with the same coaching (P9-T09a).
  const editing = display !== "tree" && okrTree !== null;
  const rhythmRead = editing
    ? await callAction(context, "rhythm.read", {})
    : null;

  const canEdit = accessLevel >= ACCESS_LEVELS.edit;
  const canAdminister = accessLevel >= ACCESS_LEVELS.full;

  // Whether a new objective may be written in this cycle now, read before
  // anybody presses "+ New objective", so the button opens the practice's
  // reason and the place it is resolved rather than a field the server will
  // refuse (P9-T07b-a, acceptance U8).
  const creation =
    cycleId && canEdit
      ? await callAction(context, "goals.creationPolicy", { cycleId })
      : null;
  const refusal =
    creation && !creation.allowed
      ? {
          reasons: creation.reasons,
          links: [
            ...(creation.rules.some(
              (rule) =>
                rule === "phases.enforcement" || rule === "writing.when",
            )
              ? [
                  {
                    href: `/cycle?cycle=${cycleId}`,
                    label: t("okrList.seeTheCycle"),
                  },
                ]
              : []),
            ...(canAdminister
              ? [
                  {
                    href: "/admin/practice",
                    label: t("okrList.changeThePractice"),
                  },
                ]
              : []),
          ],
        }
      : null;
  const progressMax = await progressCeiling();

  const alignment = cycleId
    ? await callAction(context, "alignment.read", {
        cycleId,
        includeDismissed: false,
      })
    : null;

  const href = (patch: Record<string, string | null>): string => {
    const next = new URLSearchParams();
    // Every filter the page understands, so a chip that changes one keeps the
    // rest. The two added in P4-T15d were missing from this list at first, which
    // meant clicking any chip silently cleared them: caught by an e2e assertion
    // that the other half of the filter survived.
    const merged = {
      cycle: cycleId,
      level: level ?? null,
      health: health ?? null,
      mine: mine ? "1" : null,
      scope: scopeTab === "team" || scopeTab === "company" ? scopeTab : null,
      champion: champion ?? null,
      space: space ?? null,
      kind: kind ?? null,
      view: tree ? null : "list",
      closed: includeClosed ? "1" : null,
      display: display === "editor" ? null : display,
      ...patch,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        next.set(key, value);
      }
    }
    const query = next.toString();
    return query ? `/goals?${query}` : "/goals";
  };

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        {/* **Two rows of two, not four things on one line.** Four groups on
         * one line put the title, the set it belongs to, a score and an export
         * at the same rank, and each pushed the next towards the middle. The
         * split is by what each row answers: the first says what you are
         * looking at and how it is doing, the second is what you can do to it.
         * Agung asked for this shape after the filter bar was fixed. */}
        <CardHeader className="flex-col items-stretch gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            {/* Identity and state as one unit on the left, rather than a title
             * with a sentence under it that repeated what the table below
             * already says. The chip reports what is on screen; the table owns
             * the empty state and its suggestion. */}
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="flex-none text-lg font-bold text-ink">
                {t("okrList.title")}
              </h1>
              <Chip tone={filtered ? "brand" : "neutral"}>
                {/* Never "nothing in this cycle" from a filtered count. The
                 * cycle had two goals and the filters excluded both, and this
                 * line claimed the cycle was empty while the table forty
                 * pixels below correctly said no goals matched. One screen,
                 * two answers, and the wrong one was the louder. */}
                {shownCount === 0
                  ? filtered
                    ? t("goals.noMatchForTheseFilters")
                    : t("goals.noGoalsInThisCycleYet")
                  : countChip(
                      t,
                      shownCount,
                      filtered,
                      tree && display === "tree",
                    )}
              </Chip>
            </div>
            {alignment?.score !== null && alignment !== null ? (
              <AlignmentScore
                score={alignment.score}
                healthy={alignment.healthy === true}
                label={t("goals.alignment")}
              />
            ) : null}
          </div>
          {summary.objectives > 0 ? (
            <p data-testid="okr-summary" className="text-xs text-ink-3">
              {t("okrList.summary", {
                objectives: summary.objectives,
                keyResults: summary.keyResults,
                average: summary.average,
                atRisk: summary.atRisk,
                outdated: summary.outdated,
              })}
            </p>
          ) : null}

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            {/* Which cycle is on screen, and the way another one is made.
             * Beside the title rather than in the filter bar below: it is the
             * first question this screen answers and it is not a filter, it is
             * the set. */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <CyclePicker
                cycles={cycles}
                cycleId={cycleId}
                hrefTemplate={href({ cycle: CYCLE_PLACEHOLDER })}
                canCreate={canAdminister}
              />
              {/* Beside the cycle, because the two answer one after the other:
               * which set am I looking at, and what do I want to put in it.
               * The set also carries an add row under it, for the moment
               * somebody is already reading. */}
              {canEdit && cycleId ? (
                <NewObjectiveButton
                  cycleId={cycleId}
                  level={levelForNew}
                  refusal={refusal}
                  // The topbar's `+ New` lands here (P9-T07b-a).
                  initiallyOpen={query.new === "objective"}
                  kinds={kindsInUse}
                  defaultKind={defaultOkrKind(
                    practiceRead.practice as ResolvedPractice,
                  )}
                  askReason={
                    okrTree?.cycle.midCycle &&
                    practiceRead.practice["reasons.midCycleAddition"] !== "off"
                      ? (practiceRead.practice["reasons.midCycleAddition"] as
                          | "optional"
                          | "required")
                      : null
                  }
                />
              ) : null}
              {/* Check in's door now that it has left the sidebar
               * (P9-T07a-b, okr-entry-points.md §3.1). */}
              {canEdit ? (
                <Link
                  href="/check-in"
                  className={buttonVariants({ size: "sm" })}
                >
                  {t("okrList.checkInAll")}
                </Link>
              ) : null}
            </div>
            {/*
             * Taking the list away, beside the thing it is a list of (P5-T13).
             * The file matches the rows and columns on screen, and every export
             * writes an audit row: it is the one action that takes data out of
             * the product.
             */}
            <ExportButton onExport={exportListAction.bind(null, "goals")} />
          </div>
        </CardHeader>
        {/*
         * Where a queued export is collected (P5-T15). Renders nothing until
         * somebody has one, so a person who only ever exports small lists
         * never sees an empty heading.
         */}
        <MyExports />
        <CardBody className="flex flex-col gap-2.5">
          <Filters
            level={level ?? null}
            levels={cycleLevels}
            health={health ?? null}
            scope={scopeTab}
            members={members}
            spaces={spaces}
            champion={champion ?? null}
            space={space ?? null}
            kind={kindsInUse.length > 1 ? (kind ?? null) : undefined}
            filterAssist={filterAssistAvailable ? <FilterAssist /> : undefined}
            tree={tree}
            display={display}
            includeClosed={includeClosed}
            href={href}
          />
        </CardBody>
      </Card>

      {display === "editor" ? (
        <OkrTable
          initialTree={okrTree}
          initialAt={treeReadAt}
          members={members}
          spaces={spaces}
          refusal={refusal}
          coach={{
            thresholds: (rhythmRead?.thresholds ??
              defaultThresholds()) as ResolvedThresholds,
            practice: practiceRead.practice as ResolvedPractice,
          }}
          scope={scope}
          filters={filters}
          cycleId={cycleId}
          // The level a row added here is written at. The filter when one is
          // chosen, so a filtered set adds to itself rather than adding a row
          // the filter immediately hides; team otherwise, which is the level
          // §4.3 puts most objectives at.
          level={levelForNew}
          canEdit={canEdit}
          canAdminister={canAdminister}
          progressMax={progressMax}
          empty={
            <div className="flex flex-col gap-1.5 p-3">
              <p className="text-sm text-ink-2">
                {t("goals.noGoalsMatchThis")}
              </p>
            </div>
          }
        />
      ) : null}

      {display === "diagram" ? (
        <OkrDiagram
          initialTree={okrTree}
          initialAt={treeReadAt}
          alignment={alignment}
          levels={cycleLevels}
          scope={scope}
          filters={filters}
          cycleId={cycleId}
          canEdit={canEdit}
          canAdminister={canAdminister}
          progressMax={progressMax}
          members={members}
          spaces={spaces}
          coach={{
            thresholds: (rhythmRead?.thresholds ??
              defaultThresholds()) as ResolvedThresholds,
            practice: practiceRead.practice as ResolvedPractice,
          }}
          empty={
            <div className="flex flex-col gap-1.5 p-3">
              <p className="text-sm text-ink-2">
                {t("goals.noGoalsMatchThis")}
              </p>
            </div>
          }
        />
      ) : null}

      {/* The same table the Work Map draws (`01-work-map`), not a card per
       * goal. S-13 has no mockup, and §10 treats a detail only the mockups
       * show as the proposed default, so the one drawing of a goal row this
       * repository has is the one both screens use. The explorer's own tree
       * ordering stays here: it walks what survived the filters and has to
       * mark a goal whose parent did not. */}
      {display === "tree" ? (
        <GoalTable
          nodes={(tree
            ? inTreeOrder(goals)
            : goals.map((goal) => ({
                goal,
                depth: 0,
                detached: false,
              }))
          ).flatMap(({ goal, depth, detached }) =>
            mapNodesFor(
              t,
              goal,
              depth,
              detached ? t("goals.parentIsOutsideThisFilter") : undefined,
            ),
          )}
          selected={null}
          rowHref={(node) => `/goals/${node.goalId}`}
          empty={
            <div className="flex flex-col gap-1.5 p-3">
              <p className="text-sm text-ink-2">
                {t("goals.noGoalsMatchThis")}
              </p>
              <p className="text-xs text-ink-3">
                {t("goals.objectivesAreDraftedIn")}{" "}
                <a className="underline" href="/cycle?phase=4">
                  {t("goals.openDrafting")}
                </a>
                .
              </p>
            </div>
          }
        />
      ) : null}
    </div>
  );
}

/**
 * What the header chip says about the set on screen: how many goals, and
 * whether a filter or the tree is shaping them. One whole message per case, so
 * a translator never assembles the phrase from pieces.
 */
/**
 * The count beside the title.
 *
 * `tree` here means "and it is drawn as a tree", which is true only under the
 * tree rendering. It used to read the ordering parameter alone, so the chip
 * said "9 goals, as a tree" while the editable list was on screen: the same
 * confusion between the rendering and the ordering that the toolbar had.
 */
/**
 * The cycle of the objective a drawer link names (P9-T08a), so a link to an
 * objective in last quarter opens last quarter rather than a drawer that
 * cannot find it. Null for anything the reader may not see or that is not
 * there: the page then opens on the current cycle, and the drawer says it
 * found nothing, which is the same answer a stranger's id gets everywhere.
 */
async function drawerCycle(
  context: Parameters<typeof callAction>[0],
  goalId: string | undefined,
): Promise<string | null> {
  if (!goalId || !/^[0-9a-f-]{36}$/i.test(goalId)) {
    return null;
  }
  try {
    return (await callAction(context, "goals.read", { id: goalId })).cycleId;
  } catch (error) {
    if (error instanceof OperationError) {
      return null;
    }
    throw error;
  }
}

/**
 * The alignment score, as a figure with its denominator.
 *
 * "ALIGNMENT 100" on its own could be a percentage, a score out of a hundred
 * or a points total; `05-alignment-studio` writes "73 / 100". Only the value
 * is coloured, because the total carries no verdict. Lifted out of the header
 * when that header became two rows, so the row is a line of two things rather
 * than a line with a paragraph of markup in the middle of it.
 */
function AlignmentScore({
  score,
  healthy,
  label,
}: {
  readonly score: number;
  readonly healthy: boolean;
  readonly label: string;
}) {
  return (
    <a
      href="/cycle?phase=5"
      className="flex flex-none items-baseline gap-2 rounded-control px-2 py-1 hover:bg-raised"
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <span className="flex items-baseline gap-0.5">
        <span
          className={
            healthy
              ? "text-lg font-bold tabular-nums text-ok"
              : "text-lg font-bold tabular-nums text-warn"
          }
        >
          {score}
        </span>
        {/* `--ink-3`, not `--ink-4`. The denominator is content, and
         * `--ink-4` measures 2.56:1 on this surface. */}
        <span className="text-xs font-semibold tabular-nums text-ink-3">
          / 100
        </span>
      </span>
    </a>
  );
}

function countChip(
  t: (key: string, values?: MessageValues) => string,
  count: number,
  filtered: boolean,
  tree: boolean,
): string {
  const goals =
    count === 1
      ? t("common.count.goalOne", { count })
      : t("common.count.goalOther", { count });
  if (filtered && tree) {
    return t("goals.countFilteredAsATree", { goals });
  }
  if (filtered) {
    return t("goals.countFiltered", { goals });
  }
  if (tree) {
    return t("goals.countAsATree", { goals });
  }
  return goals;
}

interface Summary {
  readonly objectives: number;
  readonly keyResults: number;
  readonly average: number;
  readonly atRisk: number;
  readonly outdated: number;
}

/**
 * The summary line under the header (design §3): how many, how far on
 * average, and how many need a look. Counted over what is on screen, so a
 * filter narrows the summary with the list.
 */
function summarise(
  rows: readonly {
    readonly progressPct: number;
    readonly health: string;
    readonly keyResults: number;
  }[],
): Summary {
  return {
    objectives: rows.length,
    keyResults: rows.reduce((sum, row) => sum + row.keyResults, 0),
    average:
      rows.length === 0
        ? 0
        : Math.round(
            rows.reduce((sum, row) => sum + row.progressPct, 0) / rows.length,
          ),
    atRisk: rows.filter(
      (row) => row.health === "caution" || row.health === "off_track",
    ).length,
    outdated: rows.filter((row) => row.health === "outdated").length,
  };
}

/** §3.2's bands, in the order the explorer offers them. */
const GOAL_HEALTH_BANDS = [
  "pending",
  "on_track",
  "caution",
  "off_track",
  "outdated",
  "achieved",
  "missed",
] as const;

async function Filters({
  level,
  levels,
  health,
  scope,
  members,
  spaces,
  champion,
  space,
  kind,
  tree,
  display,
  includeClosed,
  href,
  filterAssist,
}: {
  readonly level: string | null;
  /** The levels this cycle offers; the level chips show only these. */
  readonly levels: readonly string[];
  readonly health: string | null;
  readonly scope: "all" | "mine" | "team" | "company";
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly champion: string | null;
  readonly space: string | null;
  /**
   * The kind chosen, or null for either. Undefined where the workspace uses
   * one kind, which hides the group: every objective is then that kind.
   */
  readonly kind: "committed" | "aspirational" | null | undefined;
  readonly tree: boolean;
  readonly display: "editor" | "diagram" | "tree";
  readonly includeClosed: boolean;
  readonly href: (patch: Record<string, string | null>) => string;
  /** The sentence-to-filter box, when a provider can answer. */
  readonly filterAssist?: ReactNode;
}) {
  const { t } = await getTranslations();

  return (
    // Two columns from `2xl` (1536px), not `xl`. Measured at 1280 the split
    // left only 536px for the groups, which pushed them from two rows to four
    // and made the toolbar 244px tall against 114px at 1600. Two columns are
    // worth it only where there is genuinely room for two.
    //
    // The filter groups on the left, the sentence box on
    // the right. The groups are sized by their content and stop at about 55
    // percent of a wide card, which left the right half of the toolbar empty.
    // Filling it with the control that was sitting in a row of its own uses the
    // space and removes a row, where stretching the tracks would only have made
    // long grey slabs with the chips packed at one end.
    <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between 2xl:gap-8">
      {/* **One row, and one control per question.**
       *
       * This was six labelled groups over two ragged rows, and two of them
       * said the same two words. `Display` offered List, Diagram and Tree;
       * `View` offered Tree and List and meant the ordering *inside* the tree
       * table, which does nothing at all under the other two displays. Agung
       * asked what the difference was, which is the question a reader should
       * never have to ask of a toolbar.
       *
       * So the rendering is one segmented control, the ordering appears only
       * under the rendering it belongs to, and the two yes-or-no filters are
       * one chip each instead of a labelled pair. Six groups become four
       * controls, and the label sits in the track rather than above it. */}
      <div className="-mx-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 overflow-x-auto px-0.5">
        <Group label={t("goals.editor.displayGroup")}>
          <Tab href={href({ display: null })} active={display === "editor"}>
            {t("goals.editor.displayList")}
          </Tab>
          <Tab
            href={href({ display: "diagram" })}
            active={display === "diagram"}
          >
            {t("goals.editor.displayDiagram")}
          </Tab>
          <Tab href={href({ display: "tree" })} active={display === "tree"}>
            {t("goals.editor.displayTree")}
          </Tab>
        </Group>

        {/* Only under the tree, because the ordering is a property of that
         * table and of nothing else. Hidden rather than disabled: a control
         * that can never apply here is not a control a reader has to reason
         * about. */}
        {display === "tree" ? (
          <Group label={t("goals.editor.orderGroup")}>
            <Tab href={href({ view: null })} active={tree}>
              {t("goals.editor.orderNested")}
            </Tab>
            <Tab href={href({ view: "list" })} active={!tree}>
              {t("goals.editor.orderFlat")}
            </Tab>
          </Group>
        ) : null}

        <span aria-hidden="true" className="h-5 w-px flex-none bg-line" />

        <Group label={t("common.level")}>
          <Tab href={href({ level: null })} active={level === null}>
            {t("goals.all")}
          </Tab>
          {ALIGNMENT_LEVEL_ORDER.filter((entry) => levels.includes(entry)).map(
            (entry) => (
              <Tab
                key={entry}
                href={href({ level: entry })}
                active={level === entry}
              >
                {entry}
              </Tab>
            ),
          )}
        </Group>

        <Group label={t("workMap.health")}>
          <Tab href={href({ health: null })} active={health === null}>
            {t("common.any")}
          </Tab>
          {GOAL_HEALTH_BANDS.map((band) => (
            <Tab
              key={band}
              href={href({ health: band })}
              active={health === band}
            >
              {band.replace("_", " ")}
            </Tab>
          ))}
        </Group>

        {kind !== undefined ? (
          <Group label={t("okrKind.label")}>
            <Tab href={href({ kind: null })} active={kind === null}>
              {t("common.any")}
            </Tab>
            <Tab
              href={href({ kind: "committed" })}
              active={kind === "committed"}
            >
              {t("okrKind.committed")}
            </Tab>
            <Tab
              href={href({ kind: "aspirational" })}
              active={kind === "aspirational"}
            >
              {t("okrKind.aspirational")}
            </Tab>
          </Group>
        ) : null}

        {/* Two filters that are a yes or a no, drawn as a yes or a no. A pair
         * of options each needed a label to say which pair it was; a single
         * chip says it in the word on the chip. `aria-pressed` is what tells
         * somebody who cannot see the fill which way it is set. */}
        {/* The scope tabs (design §3): whose objectives these are. Mine
         * keeps the `mine=1` the filter assist writes. */}
        <Group label={t("okrList.scope")}>
          <Tab
            href={href({ mine: null, scope: null })}
            active={scope === "all"}
          >
            {t("goals.all")}
          </Tab>
          <Tab
            href={href({ mine: "1", scope: null })}
            active={scope === "mine"}
          >
            {t("goals.mine")}
          </Tab>
          <Tab
            href={href({ mine: null, scope: "team" })}
            active={scope === "team"}
          >
            {t("okrList.myTeam")}
          </Tab>
          <Tab
            href={href({ mine: null, scope: "company" })}
            active={scope === "company"}
          >
            {t("okrList.company")}
          </Tab>
        </Group>
        <FilterSelect
          label={t("okrList.champion")}
          value={champion}
          options={members}
          anyLabel={t("common.any")}
          hrefTemplate={href({ champion: FILTER_PLACEHOLDER })}
          anyHref={href({ champion: null })}
        />
        <FilterSelect
          label={t("okrList.space")}
          value={space}
          options={spaces}
          anyLabel={t("common.any")}
          hrefTemplate={href({ space: FILTER_PLACEHOLDER })}
          anyHref={href({ space: null })}
        />
        <Toggle
          href={href({ closed: includeClosed ? null : "1" })}
          on={includeClosed}
          label={t("goals.editor.filterClosed")}
        />
      </div>

      {filterAssist ? (
        <div className="2xl:w-96 2xl:flex-none">{filterAssist}</div>
      ) : null}
    </div>
  );
}

function Group({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    // A named group, because "Any" and "All" appear in more than one of these
    // and a test that clicks the wrong one passes for the wrong reason. Naming
    // the region is also what a screen reader wants: the chips mean nothing
    // without knowing which filter they belong to.
    // A `fieldset`, not a `div role="group"`: the a11y lint asks for the
    // element that already has the role, and `getByRole("group")` finds
    // either.
    <fieldset
      aria-label={label}
      // One line, with the caption inside the track rather than above it. The
      // stacked caption cost a whole row of height per group and made six
      // groups read as six paragraphs; inside the track it reads as the track
      // own name and the row halves.
      className="flex min-w-0 items-center gap-1 rounded-control bg-raised p-0.5 pl-2"
    >
      {/* 10px against the options 12px, and `--ink-3` rather than
       * `--ink-4`. Rank comes from size, where it costs no contrast: at the
       * same size the only thing separating "HEALTH" from "pending" was
       * colour, and that colour measured 2.56:1 against §7 4.5:1 floor. */}
      <span className="flex-none text-[10px] font-bold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-0.5">
        {children}
      </div>
    </fieldset>
  );
}

/**
 * A filter that is a yes or a no.
 *
 * A pair of options needs a caption to say which pair it is; one chip says it
 * in its own word. It stays a link, so the state is still a URL somebody can
 * send, and `aria-current` carries what the fill carries for anybody who
 * cannot see it. Not `aria-pressed`: that belongs to a button, and this is a
 * link to another state of the same page, which is what every other chip in
 * this toolbar is.
 */
function Toggle({
  href,
  on,
  label,
}: {
  readonly href: string;
  readonly on: boolean;
  readonly label: string;
}) {
  return (
    <a
      href={href}
      aria-current={on ? "true" : undefined}
      className={
        on
          ? "inline-flex h-7 flex-none items-center whitespace-nowrap rounded-control border border-brand-line bg-brand-weak px-2.5 text-xs font-semibold text-brand-text"
          : "inline-flex h-7 flex-none items-center whitespace-nowrap rounded-control border border-line bg-surface px-2.5 text-xs font-medium text-ink-3 hover:border-line-2 hover:text-ink-2"
      }
    >
      {label}
    </a>
  );
}

function Tab({
  href,
  active,
  children,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      // `h-6` is 24px, which is WCAG 2.2 SC 2.5.8's floor. These were 20px
      // links, and the inline-in-a-sentence exemption does not cover a chip in
      // a toolbar.
      className={
        active
          ? "inline-flex h-6 flex-none items-center whitespace-nowrap rounded-[6px] bg-surface px-2.5 text-xs font-semibold text-brand-text shadow-control"
          : "inline-flex h-6 flex-none items-center whitespace-nowrap rounded-[6px] px-2.5 text-xs font-medium text-ink-3 hover:bg-surface/60 hover:text-ink-2"
      }
    >
      {children}
    </a>
  );
}

/**
 * Parents before children, and every goal exactly once.
 *
 * A goal whose parent is not in the filtered set is drawn at the root and
 * flagged, rather than dropped: a filter that silently hides work is worse than
 * one that shows it out of place and says so.
 */
function inTreeOrder(
  goals: readonly Goal[],
): { goal: Goal; depth: number; detached?: boolean }[] {
  const present = new Set(goals.map((goal) => goal.id));
  const childrenOf = new Map<string, Goal[]>();
  const roots: { goal: Goal; detached: boolean }[] = [];

  for (const goal of goals) {
    const parent = goal.parentGoalId;
    if (parent && present.has(parent)) {
      const siblings = childrenOf.get(parent);
      if (siblings) {
        siblings.push(goal);
      } else {
        childrenOf.set(parent, [goal]);
      }
    } else {
      roots.push({ goal, detached: Boolean(goal.parentGoalId) });
    }
  }

  const ordered: { goal: Goal; depth: number; detached?: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (goal: Goal, depth: number, detached: boolean): void => {
    if (seen.has(goal.id)) {
      // A parent cycle cannot be made through the interface, but an import
      // could, and a page that hangs is worse than one that stops descending.
      return;
    }
    seen.add(goal.id);
    ordered.push({ goal, depth, detached });
    for (const child of childrenOf.get(goal.id) ?? []) {
      walk(child, depth + 1, false);
    }
  };
  for (const root of roots) {
    walk(root.goal, 0, root.detached);
  }
  return ordered;
}
