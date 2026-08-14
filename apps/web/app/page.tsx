import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { resolveAccessLevelFor } from "../lib/access";
import { AppShellLayout } from "../lib/app-shell.tsx";
import { getPool } from "../lib/auth";
import { requireWorkspace } from "../lib/workspace";
import { type MapNode, WorkMap } from "./work-map.tsx";

/**
 * The Work Map, the front door (UIUX-PLAN.md §4 S-01, P3-T11).
 *
 * Replaces the proving dashboard P1-T08 put here, which was scaffolding and said
 * so. One tree over goals, sub-goals and key results, with the uniform node
 * contract S-01 describes. Initiatives, tasks and KPI tiles join the same tree in
 * Phase 5 and P3-T12 without the row component changing.
 *
 * **The tree is flattened on the server, parents before children.** A nested
 * render would put the DOM depth at the mercy of how deep somebody aligned their
 * goals, and would make virtualisation impossible later: a virtual list needs
 * siblings. Depth is a number on each row, not a shape in the markup.
 *
 * **Every node is a deep link.** Selecting one is `?node=<id>`, so a row is a URL
 * somebody can send, and the panel opens without the list losing its place
 * because the list never re-orders.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; cycle?: string; scope?: string }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const query = await searchParams;

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  const cycles = await callAction(context, "cycles.list", {});
  const current = await callAction(context, "cycles.current", {
    mode: "quarterly",
  });
  const cycleId = query.cycle ?? current?.id ?? cycles[0]?.id ?? null;

  const { goals } = cycleId
    ? await callAction(context, "goals.list", {
        cycleId,
        includeClosed: false,
      })
    : { goals: [] };

  const nodes = flatten(goals);
  const selected = nodes.find((node) => node.id === query.node) ?? null;

  const hrefFor = (nodeId: string | null): string => {
    const next = new URLSearchParams();
    if (cycleId) {
      next.set("cycle", cycleId);
    }
    if (nodeId) {
      next.set("node", nodeId);
    }
    const search = next.toString();
    return search ? `/?${search}` : "/";
  };

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Work map</h1>
              <p className="text-xs text-ink-3">
                {nodes.length === 0
                  ? "Nothing to show yet."
                  : `${goals.length} objective${
                      goals.length === 1 ? "" : "s"
                    } and their key results, health rolled up from the measures.`}
              </p>
            </div>
            <div className="flex flex-none flex-wrap gap-1">
              {cycles.map((cycle) => (
                <a
                  key={cycle.id}
                  href={
                    cycle.id === cycleId
                      ? hrefFor(query.node ?? null)
                      : `/?cycle=${cycle.id}`
                  }
                  aria-current={cycle.id === cycleId ? "true" : undefined}
                  className={
                    cycle.id === cycleId
                      ? "rounded-md bg-brand-weak px-2 py-0.5 text-xs font-semibold text-brand-text"
                      : "rounded-md px-2 py-0.5 text-xs font-medium text-ink-3 hover:bg-raised"
                  }
                >
                  {cycle.name}
                </a>
              ))}
            </div>
          </CardHeader>
          <CardBody className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
            <a className="text-xs text-brand-text underline" href="/goals">
              Filter and search in the explorer
            </a>
            <a
              className="text-xs text-brand-text underline"
              href="/goals/studio"
            >
              See the cascade
            </a>
            <a className="text-xs text-brand-text underline" href="/review">
              What you owe
            </a>
          </CardBody>
        </Card>

        <WorkMap
          nodes={nodes}
          selected={selected}
          canEdit={canEdit}
          hrefFor={hrefFor}
        />
      </div>
    </AppShellLayout>
  );
}

type Goal = Awaited<
  ReturnType<typeof callAction<"goals.list">>
>["goals"][number];

/**
 * Parents before children, key results under the goal that owns them.
 *
 * A goal whose parent is not in the set is drawn at the root rather than
 * dropped, the same way the explorer treats one: a tree that silently omits work
 * is worse than one that shows it at the wrong indent.
 */
function flatten(goals: readonly Goal[]): MapNode[] {
  const present = new Set(goals.map((goal) => goal.id));
  const childrenOf = new Map<string, Goal[]>();
  const roots: Goal[] = [];
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
      roots.push(goal);
    }
  }

  const out: MapNode[] = [];
  const seen = new Set<string>();
  const walk = (goal: Goal, depth: number): void => {
    if (seen.has(goal.id)) {
      // Unreachable through the interface, reachable through a bad import.
      return;
    }
    seen.add(goal.id);

    const confidences = goal.keyResults
      .map((keyResult) => keyResult.confidence)
      .filter((value): value is number => value !== null);

    out.push({
      id: goal.id,
      kind: "goal",
      title: goal.title,
      depth,
      owner: goal.champion.name,
      health: goal.health,
      progressPct: goal.progressPct,
      confidence:
        confidences.length === 0
          ? null
          : confidences.reduce((sum, value) => sum + value, 0) /
            confidences.length,
      timeframe: goal.timeframe
        ? `${goal.timeframe.startsOn} to ${goal.timeframe.endsOn}`
        : null,
      nextStep: nextStepFor(goal),
      goalId: goal.id,
      keyResultId: null,
      currentValue: null,
      unit: null,
    });

    for (const keyResult of goal.keyResults) {
      out.push({
        id: keyResult.id,
        kind: "key_result",
        title: keyResult.title,
        depth: depth + 1,
        owner: goal.champion.name,
        // A key result carries no health of its own: §3.5 puts health on the
        // goal, and inventing one per measure would be a second answer.
        health: goal.health,
        progressPct: keyResult.progressPct,
        confidence: keyResult.confidence,
        timeframe: keyResult.dueOn,
        nextStep: `${keyResult.currentValue} of ${keyResult.targetValue}${
          keyResult.unit ? ` ${keyResult.unit}` : ""
        }`,
        goalId: goal.id,
        keyResultId: keyResult.id,
        currentValue: keyResult.currentValue,
        unit: keyResult.unit,
      });
    }

    for (const child of childrenOf.get(goal.id) ?? []) {
      walk(child, depth + 1);
    }
  };
  for (const root of roots) {
    walk(root, 0);
  }
  return out;
}

/** What happens next on this goal, in the words the cadence already uses. */
function nextStepFor(goal: Goal): string {
  if (goal.closedAt) {
    return `closed · ${goal.successStatus ?? "no outcome"}`;
  }
  if (goal.daysPastDue !== null && goal.daysPastDue > 0) {
    return `check-in ${goal.daysPastDue} day${
      goal.daysPastDue === 1 ? "" : "s"
    } overdue`;
  }
  if (goal.nextCheckInOn) {
    return `check in by ${goal.nextCheckInOn}`;
  }
  return "no cadence set";
}
