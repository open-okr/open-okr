"use client";

import "@xyflow/react/dist/style.css";
import { Bar, useQueryClient, useTranslations } from "@openokr/ui";
import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import {
  filterGoals,
  type OkrFilters,
  type OkrGoal,
  type OkrScope,
  type OkrTree,
  okrCycleKey,
} from "../../lib/okr-tree/cache.ts";
import {
  useOkrLive,
  useOkrMutation,
  useOkrTree,
} from "../../lib/okr-tree/use-okr-tree.ts";
import { linkGoals } from "./alignment-actions.ts";
import { AlignmentPanel, type AlignmentReading } from "./alignment-panel.tsx";
import { HealthChip } from "./health-chip.tsx";
import type { Person } from "./okr-cells.tsx";
import { OkrDrawer, useDrawerAddress } from "./okr-drawer.tsx";
import type { Coach } from "./okr-editing.ts";
import {
  collapsedByDefault,
  type DiagramNode,
  keyResultHandle,
  layoutOkrTree,
} from "./okr-layout.ts";

/**
 * The OKRs drawn as a tree (P9-T09a, docs/design/p9-t00-okr-writing.md §5).
 *
 * The cycle at the root, its objectives below it with their key results
 * stacked inside each card, an objective aligned to a key result hanging from
 * that key result's row, and every parent from another cycle in a band above.
 * **The same cache as the list**, so a change in either, or in the drawer
 * both open, shows in the other at once; the layout is `okr-layout.ts`, a
 * pure function, and React Flow draws it.
 *
 * **Reading, not yet editing.** A card opens the drawer, where every field is
 * edited; editing on the card itself, adding and re-parenting are P9-T10's.
 * Linking two objectives into a dependency is here since P9-T09b, from the
 * studio, with the alignment panel beside the canvas.
 *
 * **The keyboard** (§5.4): Tab reaches the cards, the arrow keys move between
 * connected ones (up to the parent, down to the first child, left and right
 * along the siblings), and Enter or Space opens the drawer.
 */

type ObjectiveData = {
  readonly goal: OkrGoal;
  readonly collapsed: boolean;
  readonly hiddenBelow: number;
  readonly hasBelow: boolean;
  readonly progressMax: number;
  readonly onToggle: (id: string) => void;
  /** The first of two cards being linked into a dependency. */
  readonly linkFrom: boolean;
};
type ContextData = { readonly context: OkrTree["context"][number] };
type CycleData = { readonly name: string };

type ObjectiveFlowNode = Node<ObjectiveData, "objective">;
type ContextFlowNode = Node<ContextData, "context">;
type CycleFlowNode = Node<CycleData, "cycle">;

const HIDDEN_HANDLE = "!h-1 !w-1 !min-w-0 !border-0 !bg-transparent";

function ObjectiveCard({ data }: NodeProps<ObjectiveFlowNode>) {
  const { t } = useTranslations();
  const {
    goal,
    collapsed,
    hiddenBelow,
    hasBelow,
    progressMax,
    onToggle,
    linkFrom,
  } = data;
  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-lg border bg-surface text-left shadow-sm ${linkFrom ? "border-brand ring-2 ring-brand" : "border-line"}`}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <div className="flex flex-col gap-1 px-3 pt-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-3">
          {goal.level}
          <span className="truncate font-normal normal-case tracking-normal">
            {goal.champion.name}
          </span>
        </span>
        <span className="line-clamp-2 text-xs font-bold leading-snug text-ink">
          {goal.title}
        </span>
        <span className="flex items-center gap-1.5">
          <Bar
            value={goal.progressPct}
            max={progressMax}
            label={goal.title}
            className="flex-1"
          />
          <span className="text-[11px] font-semibold tabular-nums text-ink-3">
            {Math.round(goal.progressPct)}%
          </span>
          <HealthChip health={goal.health} />
        </span>
      </div>
      {collapsed ? null : (
        <ul className="mt-1.5 flex flex-col border-t border-line">
          {goal.keyResults.map((keyResult) => (
            <li
              key={keyResult.id}
              className="relative flex h-[30px] items-center gap-2 border-b border-line px-3 text-[11px] text-ink-2 last:border-b-0"
            >
              <span aria-hidden="true" className="text-ink-4">
                ○
              </span>
              <span className="min-w-0 flex-1 truncate">{keyResult.title}</span>
              <span className="tabular-nums text-ink-3">
                {Math.round(keyResult.progressPct)}%
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={keyResultHandle(keyResult.id)}
                isConnectable={false}
                className={HIDDEN_HANDLE}
              />
            </li>
          ))}
        </ul>
      )}
      {hasBelow || goal.keyResults.length > 0 ? (
        <button
          type="button"
          // A press inside a card must not also count as opening it.
          onClick={(event) => {
            event.stopPropagation();
            onToggle(goal.id);
          }}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t("okrDiagram.expand", { title: goal.title })
              : t("okrDiagram.collapse", { title: goal.title })
          }
          className="nodrag absolute right-1.5 top-1.5 rounded-control px-1 text-[10px] font-semibold text-ink-3 hover:bg-raised hover:text-ink"
        >
          {collapsed
            ? hiddenBelow > 0
              ? t("okrDiagram.moreBelow", { count: String(hiddenBelow) })
              : "+"
            : "−"}
        </button>
      ) : null}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
}

function ContextCard({ data }: NodeProps<ContextFlowNode>) {
  const { t } = useTranslations();
  const { context } = data;
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-dashed border-line bg-raised text-left">
      <div className="flex flex-col gap-0.5 px-3 pt-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-4">
          {context.cycleName ?? t("okrDiagram.anotherCycle")}
        </span>
        {/* Read-only on the canvas: it opens in its own cycle, with the
         * drawer, because this cycle's cache does not hold it. */}
        <a
          href={`/goals?okr=${context.id}`}
          className="nodrag line-clamp-2 text-xs font-semibold text-ink-2 hover:underline"
        >
          {context.title}
        </a>
      </div>
      <ul className="mt-1 flex flex-col">
        {context.keyResults.map((keyResult) => (
          <li
            key={keyResult.id}
            className="relative flex h-[22px] items-center px-3 text-[10px] text-ink-3"
          >
            <span className="truncate">{keyResult.title}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={keyResultHandle(keyResult.id)}
              isConnectable={false}
              className={HIDDEN_HANDLE}
            />
          </li>
        ))}
      </ul>
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
}

function CycleCard({ data }: NodeProps<CycleFlowNode>) {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-lg border border-brand-line bg-brand-weak px-3 text-sm font-bold text-brand-text">
      {data.name}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
}

const NODE_TYPES = {
  objective: ObjectiveCard,
  context: ContextCard,
  cycle: CycleCard,
};

export function OkrDiagram(props: {
  readonly initialTree: OkrTree | null;
  readonly initialAt: number;
  readonly scope: OkrScope;
  readonly filters: OkrFilters;
  readonly cycleId: string | null;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
  /** The cycle's alignment score and findings, for the panel beside it. */
  readonly alignment: AlignmentReading | null;
  readonly empty: React.ReactNode;
}) {
  if (props.cycleId === null || props.initialTree === null) {
    return (
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {props.empty}
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <LiveDiagram
        {...props}
        cycleId={props.cycleId}
        initialTree={props.initialTree}
      />
    </ReactFlowProvider>
  );
}

function LiveDiagram({
  initialTree,
  initialAt,
  scope,
  filters,
  cycleId,
  canEdit,
  canAdminister,
  progressMax,
  members,
  coach,
  alignment,
}: {
  readonly initialTree: OkrTree;
  readonly initialAt: number;
  readonly scope: OkrScope;
  readonly filters: OkrFilters;
  readonly cycleId: string;
  readonly canEdit: boolean;
  readonly canAdminister: boolean;
  readonly progressMax: number;
  readonly members: readonly Person[];
  readonly coach: Coach;
  readonly alignment: AlignmentReading | null;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tree = useOkrTree({
    cycleId,
    scope,
    initial: initialTree,
    initialAt,
  });
  useOkrLive(cycleId);
  const okr = useOkrMutation({ cycleId, scope });
  const drawer = useDrawerAddress();
  const flow = useReactFlow();
  const frame = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(collapsedByDefault(initialTree)),
  );
  const [dependencies, setDependencies] = useState(false);
  // Link mode, as the studio had it: the first card pressed depends on the
  // second. Null when not linking.
  const [linking, setLinking] = useState<{ from: string | null } | null>(null);
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // The filters narrow the diagram as they narrow the list; an objective
  // whose parent a filter hides hangs from the cycle.
  const shown = useMemo(
    () => ({ ...tree, goals: filterGoals(tree.goals, filters) }),
    [tree, filters],
  );
  const layout = useMemo(
    () => layoutOkrTree(shown, { collapsed, dependencies }),
    [shown, collapsed, dependencies],
  );

  const toggle = useCallback(
    (id: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      }),
    [],
  );

  const nodes = useMemo(
    () =>
      layout.nodes.map((entry): Node => {
        const base = {
          id: entry.id,
          position: { x: entry.x, y: entry.y },
          width: entry.width,
          height: entry.height,
          style: { width: entry.width, height: entry.height },
          draggable: false,
          connectable: false,
          domAttributes: { "data-node-id": entry.id } as never,
        };
        if (entry.kind === "objective") {
          return {
            ...base,
            type: "objective",
            ariaLabel: t("okrDiagram.objectiveLabel", {
              title: entry.goal.title,
              level: entry.goal.level,
              progress: String(Math.round(entry.goal.progressPct)),
              health: entry.goal.health.replace("_", " "),
            }),
            data: {
              goal: entry.goal,
              collapsed: entry.collapsed,
              hiddenBelow: entry.hiddenBelow,
              hasBelow:
                entry.hiddenBelow > 0 ||
                (layout.childrenOf.get(entry.id)?.length ?? 0) > 0,
              progressMax,
              onToggle: toggle,
              linkFrom: linking?.from === entry.id,
            } satisfies ObjectiveData,
          };
        }
        if (entry.kind === "context") {
          return {
            ...base,
            type: "context",
            ariaLabel: t("okrDiagram.contextLabel", {
              title: entry.context.title,
              cycle: entry.context.cycleName ?? t("okrDiagram.anotherCycle"),
            }),
            data: { context: entry.context } satisfies ContextData,
          };
        }
        return {
          ...base,
          type: "cycle",
          ariaLabel: entry.name,
          data: { name: entry.name } satisfies CycleData,
        };
      }),
    [layout, progressMax, toggle, t, linking],
  );

  const edges = useMemo(() => {
    // Each line named in words, so a screen reader hears what it joins.
    const titleOf = (id: string): string => {
      const entry = layout.nodes.find((node) => node.id === id);
      if (entry?.kind === "objective") {
        return entry.goal.title;
      }
      if (entry?.kind === "context") {
        return entry.context.title;
      }
      return entry?.kind === "cycle" ? entry.name : id;
    };
    return layout.edges.map(
      (edge): Edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ariaLabel:
          edge.kind === "dependency"
            ? t("okrDiagram.dependsOn", {
                from: titleOf(edge.source),
                to: titleOf(edge.target),
              })
            : t("okrDiagram.alignsTo", {
                child: titleOf(edge.target),
                parent: titleOf(edge.source),
              }),
        sourceHandle: edge.sourceHandle ?? "out",
        targetHandle: "in",
        type: "smoothstep",
        focusable: false,
        selectable: false,
        ...(edge.kind === "dependency"
          ? {
              style: { strokeDasharray: "6 4" },
              className: "okr-dependency",
            }
          : {}),
      }),
    );
  }, [layout, t]);

  const byId = useMemo(
    () => new Map(layout.nodes.map((entry) => [entry.id, entry])),
    [layout],
  );

  /** Puts a card in view, then the keyboard on it once it is drawn. */
  const focusNode = (id: string) => {
    const target = byId.get(id);
    if (!target) {
      return;
    }
    void flow.setCenter(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { zoom: flow.getZoom(), duration: 0 },
    );
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        frame.current
          ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
          ?.focus(),
      ),
    );
  };

  /**
   * A card pressed: the drawer, or in link mode the next end of a
   * dependency. The second end saves at once, and the dependencies are
   * switched on so the new line is seen.
   */
  const openIn = (entry: DiagramNode | undefined) => {
    if (entry?.kind !== "objective") {
      return;
    }
    if (!linking) {
      drawer.open(entry.id);
      return;
    }
    if (linking.from === null || linking.from === entry.id) {
      setLinking({ from: entry.id });
      return;
    }
    const from = linking.from;
    setLinkProblem(null);
    startSaving(async () => {
      const result = await linkGoals(from, entry.id);
      if (result.error) {
        setLinkProblem(result.error);
        return;
      }
      setLinking(null);
      setDependencies(true);
      await queryClient.invalidateQueries({ queryKey: okrCycleKey(cycleId) });
      router.refresh();
    });
  };

  /** A finding's objective: in the drawer here, or in its own cycle. */
  const openGoal = (goalId: string) => {
    if (tree.goals.some((goal) => goal.id === goalId)) {
      drawer.open(goalId);
    } else {
      router.push(`/goals?okr=${goalId}`);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const focused = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-node-id]",
    );
    // Only on a card itself: a key in the card's own button is the button's.
    if (!focused || focused !== event.target) {
      return;
    }
    const id = focused.dataset.nodeId as string;
    const parent = layout.parentOf.get(id);
    const siblings = parent ? (layout.childrenOf.get(parent) ?? []) : [];
    const at = siblings.indexOf(id);
    const go: Record<string, string | undefined> = {
      ArrowUp: parent,
      ArrowDown: layout.childrenOf.get(id)?.[0],
      ArrowLeft: at > 0 ? siblings[at - 1] : undefined,
      ArrowRight: at >= 0 ? siblings[at + 1] : undefined,
    };
    if (event.key in go) {
      event.preventDefault();
      const next = go[event.key];
      if (next) {
        focusNode(next);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openIn(byId.get(id));
    }
    if (event.key === "Escape" && linking) {
      setLinking(null);
    }
  };

  const objectives = layout.nodes.filter((entry) => entry.kind === "objective");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() =>
            setCollapsed(
              new Set(
                shown.goals
                  .filter((goal) => goal.level === "company")
                  .map((goal) => goal.id),
              ),
            )
          }
          className="rounded-control border border-line bg-surface px-2 py-1 font-semibold text-ink-2 hover:bg-raised"
        >
          {t("okrDiagram.collapseAll")}
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(new Set())}
          className="rounded-control border border-line bg-surface px-2 py-1 font-semibold text-ink-2 hover:bg-raised"
        >
          {t("okrDiagram.expandAll")}
        </button>
        <button
          type="button"
          aria-pressed={dependencies}
          onClick={() => setDependencies((current) => !current)}
          className="rounded-control border border-line bg-surface px-2 py-1 font-semibold text-ink-2 hover:bg-raised aria-pressed:border-brand aria-pressed:bg-brand-weak aria-pressed:text-brand-text"
        >
          {t("okrDiagram.dependencies")}
        </button>
        {canEdit ? (
          <button
            type="button"
            aria-pressed={linking !== null}
            onClick={() => {
              setLinkProblem(null);
              setLinking((current) => (current ? null : { from: null }));
            }}
            className="rounded-control border border-line bg-surface px-2 py-1 font-semibold text-ink-2 hover:bg-raised aria-pressed:border-brand aria-pressed:bg-brand-weak aria-pressed:text-brand-text"
          >
            {t("okrDiagram.linkTwo")}
          </button>
        ) : null}
        <span className="text-ink-4" aria-live="polite">
          {saving
            ? t("goals.studio.studio.savingTheLink")
            : linking
              ? linking.from === null
                ? t("okrDiagram.linkPickFirst")
                : t("okrDiagram.linkPickSecond")
              : t("okrDiagram.keyboardHint")}
        </span>
      </div>
      {linkProblem ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {linkProblem}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <section
          ref={frame}
          aria-label={t("okrDiagram.label")}
          data-testid="okr-diagram"
          onKeyDown={onKeyDown}
          className="okr-diagram h-[70vh] min-h-96 min-w-0 flex-1 overflow-hidden rounded-lg border border-line"
        >
          {objectives.length === 0 ? (
            <p
              className="p-3 text-sm text-ink-2"
              data-testid="okr-diagram-empty"
            >
              {t("okrDiagram.empty")}
            </p>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            // Low enough that thirty company objectives side by side still fit,
            // so every card the budget opens with is drawn rather than cut off.
            minZoom={0.05}
            maxZoom={1.5}
            nodesDraggable={false}
            nodesConnectable={false}
            // Only what is on screen is drawn, which is what keeps a cycle of
            // three hundred objectives quick to open (design §7).
            onlyRenderVisibleElements
            onNodeClick={(_event, node) => openIn(byId.get(node.id))}
            // The canvas's own words, in the reader's language, and true of
            // this diagram: its arrow keys follow lines rather than move cards.
            ariaLabelConfig={{
              "node.a11yDescription.default": t("okrDiagram.keyboardHint"),
              "node.a11yDescription.keyboardDisabled": t(
                "okrDiagram.keyboardHint",
              ),
              "controls.ariaLabel": t("okrDiagram.controls"),
              "controls.zoomIn.ariaLabel": t("okrDiagram.zoomIn"),
              "controls.zoomOut.ariaLabel": t("okrDiagram.zoomOut"),
              "controls.fitView.ariaLabel": t("okrDiagram.fitView"),
              "minimap.ariaLabel": t("okrDiagram.minimap"),
              "handle.ariaLabel": t("okrDiagram.handle"),
            }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </section>
        {alignment ? (
          <AlignmentPanel
            alignment={alignment}
            canEdit={canEdit}
            onOpen={openGoal}
          />
        ) : null}
      </div>

      <OkrDrawer
        tree={tree}
        okr={okr}
        canEdit={canEdit}
        canAdminister={canAdminister}
        progressMax={progressMax}
        members={members}
        coach={coach}
      />
    </div>
  );
}
