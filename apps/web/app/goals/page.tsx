import { callAction } from "@openokr/core";
import {
  ALIGNMENT_LEVEL_ORDER,
  canonThresholds,
  confidenceBand,
} from "@openokr/method";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { GOAL_TABS, SectionTabs } from "../../lib/section-tabs.tsx";
import { requireWorkspace } from "../../lib/workspace";
import { HealthChip } from "./health-chip.tsx";

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
  }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const query = await searchParams;

  const cycles = await callAction(context, "cycles.list", {});
  const current = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });
  const cycleId = query.cycle ?? current?.id ?? cycles[0]?.id ?? null;

  const level = ALIGNMENT_LEVEL_ORDER.find((entry) => entry === query.level);
  const includeClosed = query.closed === "1";
  const tree = query.view !== "list";

  const { goals } = cycleId
    ? await callAction(context, "goals.list", {
        cycleId,
        includeClosed,
        ...(level ? { level } : {}),
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
    const merged = {
      cycle: cycleId,
      level: level ?? null,
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
      <div className="mx-auto flex max-w-5xl flex-col gap-4.5">
        <SectionTabs items={GOAL_TABS} active="/goals" />
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Goals</h1>
              <p className="text-xs text-ink-3">
                {goals.length === 0
                  ? "Nothing in this cycle yet."
                  : `${goals.length} goal${goals.length === 1 ? "" : "s"}${
                      tree ? ", indented by what each one supports" : ""
                    }.`}
              </p>
            </div>
            {alignment?.score !== null && alignment !== null ? (
              <a
                href={`/cycle?phase=5`}
                className="flex flex-none flex-col items-end"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-4">
                  Alignment
                </span>
                <span
                  className={
                    alignment.healthy
                      ? "text-lg font-bold text-ok"
                      : "text-lg font-bold text-warn"
                  }
                >
                  {alignment.score}
                </span>
              </a>
            ) : null}
          </CardHeader>
          <CardBody className="flex flex-col gap-2.5">
            <Filters
              cycles={cycles}
              cycleId={cycleId}
              level={level ?? null}
              tree={tree}
              includeClosed={includeClosed}
              href={href}
            />
          </CardBody>
        </Card>

        {goals.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-2">No goals match this view.</p>
              <p className="mt-1 text-xs text-ink-3">
                Objectives are drafted in phase 4 of the cycle workspace, where
                the rules are checked as they are written.{" "}
                <a className="underline" href="/cycle?phase=4">
                  Open drafting
                </a>
                .
              </p>
            </CardBody>
          </Card>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {(tree
              ? inTreeOrder(goals)
              : goals.map((goal) => ({
                  goal,
                  depth: 0,
                  detached: false,
                }))
            ).map(({ goal, depth, detached }) => (
              <li key={goal.id} style={{ marginLeft: `${depth * 22}px` }}>
                <GoalRow goal={goal} detached={detached ?? false} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </AppShellLayout>
  );
}

function Filters({
  cycles,
  cycleId,
  level,
  tree,
  includeClosed,
  href,
}: {
  readonly cycles: readonly { id: string; name: string }[];
  readonly cycleId: string | null;
  readonly level: string | null;
  readonly tree: boolean;
  readonly includeClosed: boolean;
  readonly href: (patch: Record<string, string | null>) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

      <Group label="Closed">
        <Tab href={href({ closed: null })} active={!includeClosed}>
          Hidden
        </Tab>
        <Tab href={href({ closed: "1" })} active={includeClosed}>
          Shown
        </Tab>
      </Group>
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
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-4">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
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
      className={
        active
          ? "rounded-md bg-brand-weak px-2 py-0.5 text-xs font-semibold text-brand-text"
          : "rounded-md px-2 py-0.5 text-xs font-medium text-ink-3 hover:bg-raised"
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

function GoalRow({
  goal,
  detached,
}: {
  readonly goal: Goal;
  readonly detached: boolean;
}) {
  const thresholds = canonThresholds();
  const confidences = goal.keyResults
    .map((keyResult) => keyResult.confidence)
    .filter((value): value is number => value !== null);
  // The mean of the key results that carry one. A goal has no confidence of its
  // own: §3.2 puts confidence on the measure, and the goal's figure is a summary
  // of them rather than a number anybody typed.
  const verdict =
    confidences.length === 0
      ? null
      : confidenceBand(
          confidences.reduce((sum, value) => sum + value, 0) /
            confidences.length,
          thresholds,
        );

  return (
    <Card>
      <CardBody className="flex items-start justify-between gap-3.5 py-2.5">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <a
            href={`/goals/${goal.id}`}
            className="text-sm font-semibold text-ink hover:underline"
          >
            {goal.title}
          </a>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
            <span>{goal.level}</span>
            <span aria-hidden="true">·</span>
            <span>{goal.champion.name}</span>
            <span aria-hidden="true">·</span>
            <span>
              {goal.keyResults.length} key result
              {goal.keyResults.length === 1 ? "" : "s"}
            </span>
            {goal.daysPastDue !== null && goal.daysPastDue > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-bad">
                  {goal.daysPastDue} day{goal.daysPastDue === 1 ? "" : "s"}{" "}
                  overdue
                </span>
              </>
            ) : null}
            {detached ? (
              <Chip tone="info">parent is outside this filter</Chip>
            ) : null}
          </span>
          <span className="flex items-center gap-2">
            {/* No tone on the fill: progress is not health (the colour system's
                rule 2). The health word sits beside it. */}
            <Bar value={goal.progressPct} className="h-1.5 max-w-64 flex-1" />
            <span className="text-xs font-semibold text-ink-3">
              {Math.round(goal.progressPct)}%
            </span>
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-1">
          <HealthChip health={goal.health} />
          {verdict ? (
            <Chip
              tone={
                verdict.band === "high"
                  ? "ok"
                  : verdict.band === "medium"
                    ? "warn"
                    : "bad"
              }
            >
              {verdict.band} confidence
            </Chip>
          ) : null}
        </span>
      </CardBody>
    </Card>
  );
}
