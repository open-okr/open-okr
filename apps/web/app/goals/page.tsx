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
  CardHeader,
  Chip,
  type MessageValues,
} from "@openokr/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { workspaceReaderLevel } from "../../lib/access";
import { AreaTabs } from "../../lib/area-tabs.tsx";
import { getPool } from "../../lib/auth";
import { progressCeiling } from "../../lib/ceilings.ts";
import { memberOption, namedOption } from "../../lib/entity-options.ts";
import { healthWord } from "../../lib/health-words.ts";
import { filterGoals, type OkrScope } from "../../lib/okr-tree/cache.ts";
import { pageTitle } from "../../lib/page-title.ts";
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
import { GoalsToolbar } from "./goals-toolbar.tsx";
import { NewObjectiveButton } from "./new-objective.tsx";
import { OkrDiagram } from "./okr-diagram.tsx";
import { OkrTable } from "./okr-table.tsx";
import { CYCLE_PLACEHOLDER, FILTER_PLACEHOLDER } from "./placeholders.ts";

export const generateMetadata = pageTitle("pageTitle.goals");

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
 * alignment checks flag. A goal whose parent is outside the current filter
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
  const { t, locale } = await getTranslations();

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
  // "Mine" by default (OKRGoal UX review N5): a member opens on their own
  // objectives, and All is one tab away. `scope=all` is how All is asked for.
  // Unless the reader has none of their own in this cycle, where Mine would
  // be an empty page and All is the useful answer.
  const scopeAsked = query.mine !== undefined || query.scope !== undefined;
  const ownInCycle =
    scopeAsked || !cycleId
      ? null
      : (
          await callAction(context, "goals.tree", {
            cycleId,
            scope: "mine",
            includeClosed: true,
          })
        ).goals.length;
  const mine = query.mine === "1" || (!scopeAsked && (ownInCycle ?? 0) > 0);
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
    .map((member) => ({
      id: member.id,
      name: member.name,
      title: member.title,
    }));
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

  // How many objectives each scope tab holds under the other filters, so a
  // tab says what pressing it will show. The cycle's whole tree and the
  // reader's own are read once each, reusing whichever the list already has.
  const scopeCounts = cycleId
    ? await (async () => {
        const wholeTree =
          okrTree && scope === "all"
            ? okrTree
            : await callAction(context, "goals.tree", {
                cycleId,
                scope: "all",
                includeClosed: true,
              });
        const ownTree =
          okrTree && scope === "mine"
            ? okrTree
            : await callAction(context, "goals.tree", {
                cycleId,
                scope: "mine",
                includeClosed: true,
              });
        const others = { ...filters, level, spaceIds: undefined };
        return {
          all: filterGoals(wholeTree.goals, others).length,
          mine: filterGoals(ownTree.goals, others).length,
          team: filterGoals(wholeTree.goals, {
            ...others,
            spaceIds: mySpaceIds,
          }).length,
          company: filterGoals(wholeTree.goals, { ...others, level: "company" })
            .length,
        };
      })()
    : null;

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
      // "all" is written out since Mine became the default: without it a
      // chip clicked under All would fall back to Mine.
      scope: scopeTab === "mine" ? null : scopeTab,
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
    <>
      <AreaTabs area="goals" current="/goals" t={t} />
      <div className="flex flex-col gap-4.5">
        <Card>
          {/* **What you are looking at on the left, what you can do on the
           * right**, as the reference mockup (12-okr-home) draws it. This was
           * two rows of two: the title row, then the cycle and its actions in a
           * row of their own. One row of actions beside the title and summary
           * frees that row for the list (Goals audit, 2 November 2026). The
           * chip still reports what is on screen; the table owns the empty
           * state and its suggestion. */}
          <CardHeader className="flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
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
                {alignment?.score !== null && alignment !== null ? (
                  <AlignmentScore
                    score={alignment.score}
                    band={alignment.band}
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
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 max-md:w-full">
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
                  className={`${buttonVariants({ size: "sm" })} max-md:w-full`}
                >
                  {t("okrList.checkInAll")}
                </Link>
              ) : null}
            </div>
          </CardHeader>
          {/*
           * Where a queued export is collected (P5-T15). Renders nothing until
           * somebody has one, so a person who only ever exports small lists
           * never sees an empty heading.
           */}
          <MyExports />
          <Filters
            level={level ?? null}
            levels={cycleLevels}
            health={health ?? null}
            scope={scopeTab}
            counts={scopeCounts}
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
            // Taking the list away (P5-T13), at the end of the toolbar that
            // shapes the list. The file matches the rows on screen, and every
            // export writes an audit row.
            exportControl={
              <ExportButton
                menu
                onExport={exportListAction.bind(null, "goals")}
              />
            }
          />
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
                locale,
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
    </>
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
 * The alignment score, as a share with its unit.
 *
 * "ALIGNMENT 100" on its own could be a percentage, a score out of a hundred
 * or a points total. Since P9-T16a it is a percentage, the share of goals below
 * company level that align or stand alone (METHOD.md §5.2), so the figure
 * carries "%" rather than the "/ 100" the penalty score needed. Only the value
 * is coloured, by its band. Lifted out of the header when that header became
 * two rows, so the row is a line of two things rather than a line with a
 * paragraph of markup in the middle of it.
 */
function AlignmentScore({
  score,
  band,
  label,
}: {
  readonly score: number;
  readonly band: "healthy" | "watch" | "gap" | null;
  readonly label: string;
}) {
  return (
    <a
      href="/cycle?phase=5"
      className="flex flex-none items-baseline gap-2 rounded-control px-2 py-1 hover:bg-raised"
    >
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <span className="flex items-baseline gap-0.5">
        <span
          className={`text-lg font-bold tabular-nums ${
            band === "healthy"
              ? "text-ok"
              : band === "watch"
                ? "text-warn"
                : "text-bad"
          }`}
        >
          {score}
        </span>
        {/* `--ink-3`, not `--ink-4`. The unit is content, and `--ink-4`
         * measures 2.56:1 on this surface. */}
        <span className="text-xs font-semibold tabular-nums text-ink-3">%</span>
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
  // "Objectives", the word the page's own heading uses (usability review G1,
  // owner decision Q2).
  const goals =
    count === 1
      ? t("common.count.objectiveOne", { count })
      : t("common.count.objectiveOther", { count });
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
  counts,
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
  exportControl,
}: {
  readonly level: string | null;
  /** The levels this cycle offers; the level options show only these. */
  readonly levels: readonly string[];
  readonly health: string | null;
  readonly scope: "all" | "mine" | "team" | "company";
  /** How many objectives each scope tab holds under the other filters. */
  readonly counts: ScopeCounts | null;
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly champion: string | null;
  readonly space: string | null;
  /**
   * The kind chosen, or null for either. Undefined where the workspace uses
   * one kind, which hides the row: every objective is then that kind.
   */
  readonly kind: "committed" | "aspirational" | null | undefined;
  readonly tree: boolean;
  readonly display: "editor" | "diagram" | "tree";
  readonly includeClosed: boolean;
  readonly href: (patch: Record<string, string | null>) => string;
  /** The sentence-to-filter box, when a provider can answer. */
  readonly filterAssist?: ReactNode;
  readonly exportControl: ReactNode;
}) {
  const { t } = await getTranslations();

  // The filters in force, each as the chip that takes it away.
  const active: { readonly key: string; readonly label: string }[] = [];
  const chip = (group: string, value: string) =>
    t("goals.filter.chip", { group, value });
  if (level !== null) {
    active.push({
      key: "level",
      label: chip(t("common.level"), capital(level)),
    });
  }
  if (health !== null) {
    active.push({
      key: "health",
      label: chip(t("workMap.health"), healthWord(t, health)),
    });
  }
  if (kind !== null && kind !== undefined) {
    active.push({
      key: "kind",
      label: chip(
        t("okrKind.label"),
        kind === "committed"
          ? t("okrKind.committed")
          : t("okrKind.aspirational"),
      ),
    });
  }
  if (champion !== null) {
    const name = members.find((member) => member.id === champion)?.name;
    active.push({
      key: "champion",
      label: chip(t("okrList.champion"), name ?? champion),
    });
  }
  if (space !== null) {
    const name = spaces.find((entry) => entry.id === space)?.name;
    active.push({
      key: "space",
      label: chip(t("okrList.space"), name ?? space),
    });
  }
  if (includeClosed) {
    active.push({ key: "closed", label: t("goals.filter.includeClosed") });
  }
  const clearAllHref = href({
    level: null,
    health: null,
    kind: null,
    champion: null,
    space: null,
    closed: null,
  });

  const tabs = (
    <fieldset
      aria-label={t("okrList.scope")}
      className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]"
    >
      {(
        [
          ["all", href({ mine: null, scope: "all" }), t("goals.all")],
          ["mine", href({ mine: "1", scope: null }), t("goals.mine")],
          ["team", href({ mine: null, scope: "team" }), t("okrList.myTeam")],
          [
            "company",
            href({ mine: null, scope: "company" }),
            t("okrList.company"),
          ],
        ] as const
      ).map(([key, to, label]) => (
        <a
          key={key}
          href={to}
          aria-current={scope === key ? "true" : undefined}
          className={`border-b-2 px-2.5 pt-2.5 pb-2.25 text-[13px] whitespace-nowrap ${
            scope === key
              ? "border-brand font-semibold text-brand-text"
              : "border-transparent font-medium text-ink-3 hover:text-ink"
          }`}
        >
          {label}
          {counts ? (
            <span
              className={`ml-1 text-[11.5px] font-medium ${
                scope === key ? "text-brand-text/70" : "text-ink-4"
              }`}
            >
              {counts[key]}
            </span>
          ) : null}
        </a>
      ))}
    </fieldset>
  );

  // Drawn by the toolbar, a client component, because each icon carries a
  // tooltip and a server component cannot render one through the kit's
  // barrel export.
  const displays = {
    label: t("goals.editor.displayGroup"),
    options: [
      {
        key: "list" as const,
        href: href({ display: null }),
        label: t("goals.editor.displayList"),
        on: display === "editor",
      },
      {
        key: "diagram" as const,
        href: href({ display: "diagram" }),
        label: t("goals.editor.displayDiagram"),
        on: display === "diagram",
      },
      {
        key: "tree" as const,
        href: href({ display: "tree" }),
        label: t("goals.editor.displayTree"),
        on: display === "tree",
      },
    ],
  };

  const panel = (
    <>
      {filterAssist ? (
        <>
          <span className={PANEL_LABEL}>{t("goals.filter.describeIt")}</span>
          <div className="min-w-0">{filterAssist}</div>
        </>
      ) : null}

      {/* Only under the tree, because the ordering is a property of that
       * table and of nothing else. */}
      {display === "tree" ? (
        <PanelRow label={t("goals.editor.orderGroup")}>
          <Pill href={href({ view: null })} on={tree}>
            {t("goals.editor.orderNested")}
          </Pill>
          <Pill href={href({ view: "list" })} on={!tree}>
            {t("goals.editor.orderFlat")}
          </Pill>
        </PanelRow>
      ) : null}

      <PanelRow label={t("common.level")}>
        <Pill href={href({ level: null })} on={level === null}>
          {t("goals.all")}
        </Pill>
        {ALIGNMENT_LEVEL_ORDER.filter((entry) => levels.includes(entry)).map(
          (entry) => (
            <Pill
              key={entry}
              href={href({ level: entry })}
              on={level === entry}
            >
              {capital(entry)}
            </Pill>
          ),
        )}
      </PanelRow>

      <PanelRow label={t("workMap.health")}>
        <Pill href={href({ health: null })} on={health === null}>
          {t("common.any")}
        </Pill>
        {GOAL_HEALTH_BANDS.map((band) => (
          <Pill key={band} href={href({ health: band })} on={health === band}>
            {healthWord(t, band)}
          </Pill>
        ))}
      </PanelRow>

      {kind !== undefined ? (
        <PanelRow label={t("okrKind.label")}>
          <Pill href={href({ kind: null })} on={kind === null}>
            {t("common.any")}
          </Pill>
          <Pill href={href({ kind: "committed" })} on={kind === "committed"}>
            {t("okrKind.committed")}
          </Pill>
          <Pill
            href={href({ kind: "aspirational" })}
            on={kind === "aspirational"}
          >
            {t("okrKind.aspirational")}
          </Pill>
        </PanelRow>
      ) : null}

      <span className={PANEL_LABEL}>{t("okrList.champion")}</span>
      <div className="min-w-0">
        <FilterSelect
          bare
          label={t("okrList.champion")}
          value={champion}
          options={members.map((member) =>
            memberOption(member, t("common.agent")),
          )}
          people
          anyLabel={t("common.any")}
          hrefTemplate={href({ champion: FILTER_PLACEHOLDER })}
          anyHref={href({ champion: null })}
        />
      </div>

      <span className={PANEL_LABEL}>{t("okrList.space")}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <FilterSelect
          bare
          label={t("okrList.space")}
          value={space}
          options={spaces.map(namedOption)}
          anyLabel={t("common.any")}
          hrefTemplate={href({ space: FILTER_PLACEHOLDER })}
          anyHref={href({ space: null })}
        />
        {/* A yes or a no, drawn as a box that is ticked or not. It stays a
         * link, so the state is still an address somebody can send. */}
        <a
          href={href({ closed: includeClosed ? null : "1" })}
          aria-current={includeClosed ? "true" : undefined}
          className="inline-flex items-center gap-1.75 text-[12.5px] text-ink-2"
        >
          <span
            aria-hidden="true"
            className={`grid size-3.75 place-items-center rounded-[4px] border ${
              includeClosed
                ? "border-brand bg-brand text-on-brand"
                : "border-line-2 bg-surface"
            }`}
          >
            {includeClosed ? (
              <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
                <path
                  d="m2.5 6 2.5 2.5 4.5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            ) : null}
          </span>
          {t("goals.filter.includeClosed")}
        </a>
      </div>
    </>
  );

  const chips =
    active.length === 0
      ? null
      : active.map((one) => (
          <a
            key={one.key}
            href={href({ [one.key]: null })}
            aria-label={t("goals.filter.removeOne", { filter: one.label })}
            className="inline-flex h-6.5 items-center gap-1.5 rounded-full bg-brand-weak pr-1 pl-2.5 text-xs font-semibold text-brand-text hover:bg-brand-line"
          >
            {one.label}
            <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2.5">
              <path
                d="m2 2 6 6M8 2 2 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </a>
        ));

  return (
    <GoalsToolbar
      tabs={tabs}
      display={displays}
      exportControl={exportControl}
      panel={panel}
      chips={chips}
      clearAll={
        active.length === 0 ? null : (
          <a
            href={clearAllHref}
            className="px-1.5 text-[12.5px] font-semibold text-brand-text hover:underline"
          >
            {t("goals.filter.clearAll")}
          </a>
        )
      }
      activeCount={active.length}
    />
  );
}

/** How many objectives each scope tab holds, under the other filters. */
interface ScopeCounts {
  readonly all: number;
  readonly mine: number;
  readonly team: number;
  readonly company: number;
}

const PANEL_LABEL = "text-xs font-semibold text-ink-3 max-md:mt-1.5";

/** One question of the filter panel: its name, then its options. */
function PanelRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <>
      <span aria-hidden="true" className={PANEL_LABEL}>
        {label}
      </span>
      {/* A named group, because "All" appears in more than one row
       * and a test that clicks the wrong one passes for the wrong reason;
       * the name is also what a screen reader needs. */}
      <fieldset
        aria-label={label}
        className="flex min-w-0 flex-wrap items-center gap-1.5"
      >
        {children}
      </fieldset>
    </>
  );
}

/** One option of the panel, a link to the list with it chosen. */
function Pill({
  href,
  on,
  children,
}: {
  readonly href: string;
  readonly on: boolean;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      aria-current={on ? "true" : undefined}
      className={`inline-flex h-6.5 items-center rounded-full border px-2.5 text-xs whitespace-nowrap ${
        on
          ? "border-brand bg-brand-weak font-semibold text-brand-text"
          : "border-line-2 bg-surface font-medium text-ink-2 hover:border-ink-4"
      }`}
    >
      {children}
    </a>
  );
}

/** A level as a reader writes it: "company" reads "Company". */
function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
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
