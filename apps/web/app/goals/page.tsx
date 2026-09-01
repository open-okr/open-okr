import { callAction } from "@openokr/core";
import { ALIGNMENT_LEVEL_ORDER } from "@openokr/method";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import type { ReactNode } from "react";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { GOAL_TABS, SectionTabs } from "../../lib/section-tabs.tsx";
import { requireWorkspace } from "../../lib/workspace";
import { mapNodesFor } from "../goal-nodes.ts";
import { GoalTable } from "../work-map.tsx";
import { filterAssistAvailableAction } from "./filter-actions.ts";
import { FilterAssist } from "./filter-assist.tsx";

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
  }>;
}) {
  const { session, workspace } = await requireWorkspace();
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
  const cycleId = query.cycle ?? current?.id ?? cycles[0]?.id ?? null;

  const level = ALIGNMENT_LEVEL_ORDER.find((entry) => entry === query.level);
  // Validated against the band list rather than passed through, so a hand-edited
  // URL cannot ask for a band the product does not have.
  const health = GOAL_HEALTH_BANDS.find((entry) => entry === query.health);
  const mine = query.mine === "1";
  const includeClosed = query.closed === "1";
  const tree = query.view !== "list";
  // Whether anything is narrowing the set. Derived rather than counted a second
  // time: the difference between "this cycle has no goals" and "your filters
  // left nothing" is knowable from the query alone, and getting it wrong is
  // what made the header claim an empty cycle that held two goals.
  const filtered =
    level !== undefined || health !== undefined || mine || includeClosed;

  const { goals } = cycleId
    ? await callAction(context, "goals.list", {
        cycleId,
        includeClosed,
        ...(level ? { level } : {}),
        ...(health ? { health } : {}),
        ...(mine ? { mine } : {}),
      })
    : { goals: [] };

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
      view: tree ? null : "list",
      closed: includeClosed ? "1" : null,
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
    <AppShellLayout>
      <div className="flex flex-col gap-4.5">
        <SectionTabs items={GOAL_TABS} active="/goals" />
        <Card>
          <CardHeader className="justify-between gap-4">
            {/* Identity and state as one unit on the left, rather than a title
             * with a sentence under it that repeated what the table below
             * already says. The chip reports what is on screen; the table owns
             * the empty state and its suggestion. */}
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="flex-none text-lg font-bold text-ink">Goals</h1>
              <Chip tone={filtered ? "brand" : "neutral"}>
                {/* Never "nothing in this cycle" from a filtered count. The
                 * cycle had two goals and the filters excluded both, and this
                 * line claimed the cycle was empty while the table forty
                 * pixels below correctly said no goals matched. One screen,
                 * two answers, and the wrong one was the louder. */}
                {goals.length === 0
                  ? filtered
                    ? "No match for these filters"
                    : "No goals in this cycle yet"
                  : `${goals.length} goal${goals.length === 1 ? "" : "s"}${
                      filtered ? ", filtered" : ""
                    }${tree ? ", as a tree" : ""}`}
              </Chip>
            </div>
            {alignment?.score !== null && alignment !== null ? (
              <a
                href={`/cycle?phase=5`}
                className="flex flex-none items-baseline gap-2 rounded-control px-2 py-1 hover:bg-raised"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  Alignment
                </span>
                {/* With its denominator. "ALIGNMENT 100" on its own could be a
                 * percentage, a score out of a hundred, or a points total;
                 * `05-alignment-studio` writes "73 / 100". Only the value is
                 * coloured, because the total carries no verdict. */}
                <span className="flex items-baseline gap-0.5">
                  <span
                    className={
                      alignment.healthy
                        ? "text-lg font-bold tabular-nums text-ok"
                        : "text-lg font-bold tabular-nums text-warn"
                    }
                  >
                    {alignment.score}
                  </span>
                  {/* `--ink-3`, not `--ink-4`. The denominator is content, and
                   * `--ink-4` measures 2.56:1 on this surface, which is the
                   * violation the group labels above were just fixed for. */}
                  <span className="text-xs font-semibold tabular-nums text-ink-3">
                    / 100
                  </span>
                </span>
              </a>
            ) : null}
          </CardHeader>
          <CardBody className="flex flex-col gap-2.5">
            <Filters
              cycles={cycles}
              cycleId={cycleId}
              level={level ?? null}
              health={health ?? null}
              mine={mine}
              filterAssist={
                filterAssistAvailable ? <FilterAssist /> : undefined
              }
              tree={tree}
              includeClosed={includeClosed}
              href={href}
            />
          </CardBody>
        </Card>

        {/* The same table the Work Map draws (`01-work-map`), not a card per
         * goal. S-13 has no mockup, and §10 treats a detail only the mockups
         * show as the proposed default, so the one drawing of a goal row this
         * repository has is the one both screens use. The explorer's own tree
         * ordering stays here: it walks what survived the filters and has to
         * mark a goal whose parent did not. */}
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
              goal,
              depth,
              detached ? "parent is outside this filter" : undefined,
            ),
          )}
          selected={null}
          rowHref={(node) => `/goals/${node.goalId}`}
          empty={
            <div className="flex flex-col gap-1.5 p-3">
              <p className="text-sm text-ink-2">No goals match this view.</p>
              <p className="text-xs text-ink-3">
                Objectives are drafted in phase 4 of the cycle workspace, where
                the rules are checked as they are written.{" "}
                <a className="underline" href="/cycle?phase=4">
                  Open drafting
                </a>
                .
              </p>
            </div>
          }
        />
      </div>
    </AppShellLayout>
  );
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

function Filters({
  cycles,
  cycleId,
  level,
  health,
  mine,
  tree,
  includeClosed,
  href,
  filterAssist,
}: {
  readonly cycles: readonly { id: string; name: string }[];
  readonly cycleId: string | null;
  readonly level: string | null;
  readonly health: string | null;
  readonly mine: boolean;
  readonly tree: boolean;
  readonly includeClosed: boolean;
  readonly href: (patch: Record<string, string | null>) => string;
  /** The sentence-to-filter box, when a provider can answer. */
  readonly filterAssist?: ReactNode;
}) {
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
    <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between 2xl:gap-8">
      <div className="flex min-w-0 flex-col gap-4">
        {/* Two rows, composed rather than wrapped, because six groups running
         * along one line is what made this read as a paragraph of links. The
         * split is by the question each group answers: the first row says what
         * you are looking at, the second narrows it down. Each group's label
         * sits above its own track, so the boundary between groups needs no gap
         * to carry it.
         *
         * The rows scroll, the page never does. Three attempts to make the
         * groups shrink inside the viewport failed measurement at 375: the level
         * track came out 328px and health 523px against 319px of bar. This is
         * the repository's own rule for wide content, and it is the one that
         * holds without depending on flex shrink behaviour. */}
        <div className="-mx-0.5 flex flex-wrap items-start gap-x-7 gap-y-4 overflow-x-auto px-0.5">
          <Group label="Cycle">
            {cycles.map((cycle) => (
              <Tab
                key={cycle.id}
                href={href({ cycle: cycle.id })}
                active={cycle.id === cycleId}
              >
                {cycle.name}
              </Tab>
            ))}
          </Group>

          <Group label="Level">
            <Tab href={href({ level: null })} active={level === null}>
              All
            </Tab>
            {ALIGNMENT_LEVEL_ORDER.map((entry) => (
              <Tab
                key={entry}
                href={href({ level: entry })}
                active={level === entry}
              >
                {entry}
              </Tab>
            ))}
          </Group>

          <Group label="View">
            <Tab href={href({ view: null })} active={tree}>
              Tree
            </Tab>
            <Tab href={href({ view: "list" })} active={!tree}>
              List
            </Tab>
          </Group>
        </div>

        <div className="-mx-0.5 flex flex-wrap items-start gap-x-7 gap-y-4 overflow-x-auto px-0.5">
          <Group label="Health">
            <Tab href={href({ health: null })} active={health === null}>
              Any
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

          <Group label="Whose">
            <Tab href={href({ mine: null })} active={!mine}>
              Everyone's
            </Tab>
            <Tab href={href({ mine: "1" })} active={mine}>
              Mine
            </Tab>
          </Group>

          <Group label="Closed">
            <Tab href={href({ closed: null })} active={!includeClosed}>
              Hidden
            </Tab>
            <Tab href={href({ closed: "1" })} active={includeClosed}>
              Shown
            </Tab>
          </Group>
        </div>
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
    // A `fieldset`, not a `div role="group"`: the a11y lint asks for the element
    // that already has the role, and `getByRole("group")` finds either. The
    // label is on the element rather than in a `legend`, because the visible
    // text below is the label and a legend would say it twice.
    <fieldset
      aria-label={label}
      // A column: the label above its own track. Six groups running along one
      // line with the label beside each track is what made this read as a
      // paragraph, and no gap between groups can fix that on its own.
      className="flex min-w-0 flex-col gap-1.5 border-0 p-0"
    >
      {/* 10px against the options' 12px, and `--ink-3` rather than `--ink-4`.
       * The label used to be the same 12px as the words it labels, so the only
       * thing separating "HEALTH" from "pending" was colour, and that colour
       * measured 2.56:1 against §7's 4.5:1 floor. Rank now comes from size,
       * where it costs no contrast. */}
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      {/* A segmented track, which is one move for three of the audit's
       * findings. It gives twenty options that looked like plain text a
       * visible boundary, it makes each group a unit the eye can find without
       * relying on a 16px gap, and it separates the groups from each other
       * without a divider. The active segment lifts out of the track rather
       * than only changing colour. */}
      <div className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-control bg-raised p-0.5">
        {children}
      </div>
    </fieldset>
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
