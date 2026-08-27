import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { resolveAccessLevelFor } from "../lib/access";
import { AppShellLayout } from "../lib/app-shell.tsx";
import { getPool } from "../lib/auth";
import { requireWorkspace } from "../lib/workspace";
import { type MapNode, WorkMap } from "./work-map.tsx";
import {
  type ScopeTab,
  type WorkMapContext,
  WorkMapContextStrip,
  WorkMapHeader,
  WorkMapScopeTabs,
  type WorkMapStats,
} from "./work-map-header.tsx";

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

  // The scope tab. "company" is every goal the reader may see; a space id
  // narrows to that space. S-01 names a "my spaces" tab too, and it is left out
  // rather than faked: `goals.list` filters by one space, and answering "mine"
  // properly means the reader's space membership, which is a read this screen
  // does not have yet.
  const spaces = await callAction(context, "spaces.list", {});
  const scope =
    query.scope && spaces.some((space) => space.id === query.scope)
      ? query.scope
      : "company";

  const { goals } = cycleId
    ? await callAction(context, "goals.list", {
        cycleId,
        includeClosed: false,
        ...(scope === "company" ? {} : { spaceId: scope }),
      })
    : { goals: [] };

  // The cycle's phase, its gates and its deadline (P3-T03, P4-T03). The front
  // door is where somebody asks "where are we", and a tree of goals alone does
  // not answer it.
  const workflow = cycleId
    ? await callAction(context, "workflow.read", { cycleId })
    : null;

  const alignment = cycleId
    ? await callAction(context, "alignment.read", {
        cycleId,
        includeDismissed: false,
        ...(scope === "company" ? {} : { spaceId: scope }),
      })
    : null;

  const nodes = flatten(goals);
  const selected = nodes.find((node) => node.id === query.node) ?? null;

  // Health lives on the goal, never on a key result (METHOD.md §3.5), so "on
  // track" is counted over goals and reported against the measures they carry:
  // a set of four objectives is a smaller number than the fourteen key results
  // somebody is actually reading about.
  const keyResultCount = goals.reduce(
    (sum, goal) => sum + goal.keyResults.length,
    0,
  );
  const measured = goals.filter((goal) => goal.keyResults.length > 0);
  const onTrackKeyResults = measured
    .filter((goal) => goal.health === "on_track" || goal.health === "achieved")
    .reduce((sum, goal) => sum + goal.keyResults.length, 0);
  const stats: WorkMapStats = {
    objectiveCount: goals.length,
    keyResultCount,
    onTrackPct:
      keyResultCount === 0 ? null : (onTrackKeyResults / keyResultCount) * 100,
    outdatedGoals: goals.filter((goal) => goal.health === "outdated").length,
    alignmentScore: alignment?.score ?? null,
    alignmentThreshold: alignment?.threshold ?? 0,
  };

  const workMapContext: WorkMapContext | null = workflow
    ? {
        phase: workflow.phase,
        phaseTitle:
          workflow.phases.find((phase) => phase.phase === workflow.phase)
            ?.title ?? "",
        unmetGates: workflow.gates
          .filter((gate) => !gate.passed)
          .map((gate) => gate.title),
        daysToDeadline: workflow.daysToDeadline,
        published: workflow.publishedAt !== null,
      }
    : null;

  const linkTo = (next: {
    cycle?: string | null;
    node?: string | null;
    scope?: string | null;
  }): string => {
    const params = new URLSearchParams();
    const cycle = next.cycle === undefined ? cycleId : next.cycle;
    const node = next.node === undefined ? (query.node ?? null) : next.node;
    const nextScope = next.scope === undefined ? scope : next.scope;
    if (cycle) {
      params.set("cycle", cycle);
    }
    if (nextScope && nextScope !== "company") {
      params.set("scope", nextScope);
    }
    if (node) {
      params.set("node", node);
    }
    const search = params.toString();
    return search ? `/?${search}` : "/";
  };

  const hrefFor = (nodeId: string | null): string => linkTo({ node: nodeId });

  const scopeTabs: ScopeTab[] = [
    {
      key: "company",
      label: "Company",
      href: linkTo({ scope: "company", node: null }),
    },
    ...spaces.map((space) => ({
      key: space.id,
      label: space.name,
      href: linkTo({ scope: space.id, node: null }),
    })),
  ];

  const scopeLabel =
    scope === "company"
      ? "Company-wide tree"
      : (spaces.find((space) => space.id === scope)?.name ?? "One space");

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3.5">
        <WorkMapContextStrip
          context={workMapContext}
          cycleHref={cycleId ? `/cycle?cycle=${cycleId}` : "/cycle"}
        />

        <WorkMapHeader
          workspaceName={workspace.name}
          scopeLabel={scopeLabel}
          stats={stats}
        />

        <WorkMapScopeTabs
          tabs={scopeTabs}
          active={scope}
          cycles={cycles}
          activeCycleId={cycleId}
          cycleHrefFor={(id) => linkTo({ cycle: id, node: null })}
        />

        <WorkMap
          nodes={nodes}
          selected={selected}
          canEdit={canEdit}
          hrefFor={hrefFor}
        />

        <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-ink-3">
          <a className="text-brand-text underline" href="/goals">
            Filter and search in the explorer
          </a>
          <a className="text-brand-text underline" href="/goals/studio">
            See the cascade
          </a>
          <a className="text-brand-text underline" href="/review">
            What you owe
          </a>
          {/* P5-T01c. The sidebar carries it on every page; this is here
              because the task asks for a door from the front door itself, and
              a member who lands here should not have to know the product has
              a sidebar item for the room they are late to. */}
          <a className="text-brand-text underline" href="/sessions">
            Sessions
          </a>
        </p>
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
