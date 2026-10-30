import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { workspaceReaderLevel } from "../lib/access";
import { getPool } from "../lib/auth";
import { getTranslations } from "../lib/translations";
import { requireWorkspace } from "../lib/workspace";
import { FirstVisitTour } from "./first-visit-tour.tsx";
import { goalTreeNodes } from "./goal-nodes.ts";
import { WorkMap } from "./work-map.tsx";
import {
  type ScopeTab,
  type WorkMapContext,
  WorkMapContextStrip,
  WorkMapHeader,
  WorkMapScopeTabs,
  type WorkMapStats,
} from "./work-map-header.tsx";

/**
 * The Work Map, the company's tree (UIUX-PLAN.md §4 S-01, P3-T11).
 *
 * Its own component since the role homes (OKRGoal UX review, backlog 12):
 * the review asked that the company tree stop being everybody's front door
 * and move to Goals. It is drawn at `/map`, the Map tab of Goals, for
 * everybody, and on Home inside the cockpit of the people who run the cycle.
 * `basePath` is where its own links point, so a selected row or a scope tab
 * stays on the screen it was chosen on.
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
export async function WorkMapScreen({
  query,
  basePath,
}: {
  readonly query: {
    readonly node?: string;
    readonly cycle?: string;
    readonly scope?: string;
  };
  readonly basePath: "/" | "/map";
}) {
  const { t, locale } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const level = await workspaceReaderLevel(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;
  // The first-visit tour's first stop outlines this tree, so it is drawn
  // wherever the tree is (UIUX-PLAN S-34, L-08).
  const tour = await callAction(context, "people.readOwnTour", {});

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

  const nodes = goalTreeNodes(t, goals, locale);
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
    alignmentBand: alignment?.band ?? null,
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
    return search ? `${basePath}?${search}` : basePath;
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
    <>
      <WorkMapContextStrip
        context={workMapContext}
        cycleHref={cycleId ? `/cycle?cycle=${cycleId}` : "/cycle"}
      />

      <WorkMapHeader
        workspaceName={workspace.name}
        scopeLabel={scopeLabel}
        stats={stats}
      />

      {/* Under the page's own heading, so the outline reads Work map and then
          the tour, and above the tree its first stop outlines, so a keyboard
          meets the card before the rows it introduces. Gone for good once
          finished or ended. */}
      {tour.finished ? null : <FirstVisitTour />}

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
          {t("home.filterAndSearchIn")}
        </a>
        <a className="text-brand-text underline" href="/goals?display=diagram">
          {t("home.seeTheCascade")}
        </a>
        <a className="text-brand-text underline" href="/review">
          {t("common.whatYouOwe")}
        </a>
        {/* P5-T01c. The task asks for a door from the front door itself,
            two clicks from the session, and since P9-T07a-b this is the
            only one outside the Cycle module's own tabs: Sessions left the
            sidebar for a tab inside Cycle (okr-entry-points.md §3.1). */}
        <a className="text-brand-text underline" href="/sessions">
          {t("common.sessions")}
        </a>
        {/* P6-G11a. S-31 has a screen in §6 and no slot in §3's sidebar, so
            this is how it is reached. The engine has written a row on every
            operation since P2-T07 and nothing has ever shown one. */}
        <a className="text-brand-text underline" href="/activity">
          {t("home.whatHasHappenedHere")}
        </a>
        {/* P6-G09. S-33 has a screen in §6 and no slot in §3's sidebar,
            same pattern as Activity above. */}
        <a className="text-brand-text underline" href="/people">
          {t("home.whoIsHere")}
        </a>
      </p>
    </>
  );
}
