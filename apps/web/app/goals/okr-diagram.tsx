"use client";

import "@xyflow/react/dist/style.css";
import type { GoalLevel } from "@openokr/db";
import {
  Button,
  useIsMutating,
  useQueryClient,
  useTranslations,
} from "@openokr/ui";
import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { healthWord } from "../../lib/health-words.ts";
import {
  filterGoals,
  type OkrFilters,
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
import { addKeyResult, addObjective } from "./editor-actions.ts";
import type { Person } from "./okr-cells.tsx";
import {
  DiagramContext,
  type DiagramShared,
  NODE_TYPES,
  type ObjectiveData,
} from "./okr-diagram-cards.tsx";
import { OkrDrawer, useDrawerAddress } from "./okr-drawer.tsx";
import type { Coach } from "./okr-editing.ts";
import {
  afterForSlot,
  collapsedByDefault,
  type DiagramNode,
  layoutOkrTree,
  moveTargets,
} from "./okr-layout.ts";

/**
 * The OKRs drawn as a tree (P9-T09a, docs/design/okr-writing.md §5).
 *
 * The cycle at the root, its objectives below it with their key results
 * stacked inside each card, an objective aligned to a key result hanging from
 * that key result's row, and every parent from another cycle in a band above.
 * **The same cache as the list**, so a change in either, or in the drawer
 * both open, shows in the other at once; the layout is `okr-layout.ts`, a
 * pure function, and React Flow draws it.
 *
 * **Edited where it is drawn** since P9-T10a: a card's title, its key
 * results' values and targets, and drafts for a new key result or a new
 * aligned objective, through the list's own cells (`okr-diagram-cards.tsx`).
 * A press on a card opens the drawer for everything else. Linking two
 * objectives into a dependency is here since P9-T09b, from the studio, with
 * the alignment panel beside the canvas; re-parenting is P9-T10b's.
 *
 * **The keyboard** (§5.4): Tab reaches the cards, the arrow keys move between
 * connected ones (up to the parent, down to the first child, left and right
 * along the siblings), Enter edits a card's title and Space opens the drawer.
 */

/** The levels an aligned objective may take, top down (METHOD.md §2.7). */
const LEVEL_ORDER: readonly GoalLevel[] = [
  "company",
  "department",
  "team",
  "individual",
];

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
  /** The spaces an objective can move to (P9-T13a). */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly coach: Coach;
  /** The cycle's alignment score and findings, for the panel beside it. */
  readonly alignment: AlignmentReading | null;
  /** The levels this cycle uses, for an objective added under another. */
  readonly levels: readonly string[];
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
  spaces,
  coach,
  alignment,
  levels,
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
  /** The spaces an objective can move to (P9-T13a). */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly coach: Coach;
  readonly alignment: AlignmentReading | null;
  readonly levels: readonly string[];
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
  // Any change still on its way, said on the canvas as the list says it.
  const busy = useIsMutating() > 0;
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
  // Editing and adding on a card (P9-T10a).
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [keyResultDrafts, setKeyResultDrafts] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [childDraft, setChildDraft] = useState<string | null>(null);
  // Moving (P9-T10b): the card whose "Move under…" is open, and a card
  // being dragged sideways, drawn where the pointer has it until let go.
  const [moving, setMoving] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{
    readonly id: string;
    readonly x: number;
    readonly y: number;
  } | null>(null);

  // The filters narrow the diagram as they narrow the list; an objective
  // whose parent a filter hides hangs from the cycle.
  const shown = useMemo(
    () => ({ ...tree, goals: filterGoals(tree.goals, filters) }),
    [tree, filters],
  );
  const layout = useMemo(
    () =>
      layoutOkrTree(shown, {
        collapsed,
        dependencies,
        actions: canEdit,
        drafts: keyResultDrafts,
        draftChildOf: childDraft,
      }),
    [shown, collapsed, dependencies, canEdit, keyResultDrafts, childDraft],
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
          position:
            dragged?.id === entry.id
              ? { x: dragged.x, y: dragged.y }
              : { x: entry.x, y: entry.y },
          width: entry.width,
          height: entry.height,
          style: { width: entry.width, height: entry.height },
          draggable: canEdit && entry.kind === "objective",
          connectable: false,
          domAttributes: { "data-node-id": entry.id } as never,
        };
        if (entry.kind === "objective") {
          return {
            ...base,
            type: "objective",
            ariaLabel: t("okrDiagram.objectiveLabel", {
              title: entry.goal.title,
              kind: (entry.goal.kind === "committed"
                ? t("okrKind.committed")
                : t("okrKind.aspirational")
              ).toLowerCase(),
              level: entry.goal.level,
              progress: String(Math.round(entry.goal.progressPct)),
              health: healthWord(t, entry.goal.health),
            }),
            data: {
              goal: entry.goal,
              collapsed: entry.collapsed,
              hiddenBelow: entry.hiddenBelow,
              hasBelow:
                entry.hiddenBelow > 0 ||
                (layout.childrenOf.get(entry.id)?.length ?? 0) > 0,
              drafting: entry.drafting,
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
            data: { context: entry.context },
          };
        }
        if (entry.kind === "draft") {
          return {
            ...base,
            type: "draft",
            ariaLabel: t("okrDiagram.newAligned"),
            data: { parentId: entry.parentId },
          };
        }
        return {
          ...base,
          type: "cycle",
          ariaLabel: entry.name,
          data: { name: entry.name },
        };
      }),
    [layout, t, dragged, canEdit],
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
      if (entry?.kind === "draft") {
        return t("okrDiagram.newAligned");
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
    // Alt with an arrow moves the card among its siblings, as Alt with an
    // arrow moves a row in the list (P9-T10b).
    if (
      event.altKey &&
      canEdit &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      byId.get(id)?.kind === "objective"
    ) {
      event.preventDefault();
      const above = layout.parentOf.get(id);
      const row = above ? (layout.childrenOf.get(above) ?? []) : [];
      const at = row.indexOf(id);
      placeAmongSiblings(id, event.key === "ArrowLeft" ? at - 1 : at + 1);
      requestAnimationFrame(() => focusNode(id));
      return;
    }
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
    // In link mode both keys press the card; otherwise Enter edits its
    // title, where the reader may, and Space opens the drawer (§5.4).
    const entry = byId.get(id);
    if (
      event.key === "Enter" &&
      !linking &&
      canEdit &&
      entry?.kind === "objective"
    ) {
      event.preventDefault();
      setEditingTitle(id);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openIn(entry);
    }
    if (event.key === "Escape" && linking) {
      setLinking(null);
    }
  };

  // What every card shares, made once and remade only when something in it
  // moves, so pressing one card's collapse does not draw all thirty again.
  // The tree is read through a ref: a card asks it only when it adds.
  const treeRef = useRef(tree);
  treeRef.current = tree;
  const mutate = okr.mutate;
  const linkFrom = linking?.from ?? null;
  const shared = useMemo<DiagramShared>(() => {
    /**
     * An add from a card, as the list's add rows make one: the page renders
     * again afterwards, because the header's counts and the alignment score
     * are the server's to recompute.
     */
    const added = async (
      work: () => Promise<{ error: string | null }>,
    ): Promise<string | null> => {
      const result = await work();
      if (result.error) {
        return result.error;
      }
      await queryClient.invalidateQueries({ queryKey: okrCycleKey(cycleId) });
      router.refresh();
      return null;
    };
    const expand = (goalId: string) =>
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(goalId);
        return next;
      });
    return {
      okr: { mutate },
      coach,
      canEdit,
      progressMax,
      linkFrom,
      editingTitle,
      setEditingTitle,
      onToggle: toggle,
      openKeyResultDraft: (goalId) => {
        expand(goalId);
        setKeyResultDrafts((current) => new Set(current).add(goalId));
      },
      closeKeyResultDraft: (goalId) =>
        setKeyResultDrafts((current) => {
          const next = new Set(current);
          next.delete(goalId);
          return next;
        }),
      openChildDraft: (goalId) => {
        expand(goalId);
        setChildDraft(goalId);
      },
      closeChildDraft: () => setChildDraft(null),
      // Owned by the objective's champion and due at the cycle's end, as a
      // key result added from the list is (design §4.3).
      addKeyResult: (goal, title) =>
        added(() =>
          addKeyResult({
            goalId: goal.id,
            title,
            ownerId: goal.champion.id,
            dueOn: treeRef.current.cycle.endsOn,
          }),
        ),
      // One level below its parent where the cycle uses one, else the
      // parent's own, which alignment allows (METHOD v2 §5.1).
      addAligned: (parent, title) => {
        const below = LEVEL_ORDER.slice(
          LEVEL_ORDER.indexOf(parent.level as GoalLevel) + 1,
        ).find((level) => levels.includes(level));
        return added(() =>
          addObjective({
            cycleId,
            level: below ?? (parent.level as GoalLevel),
            title,
            parentGoalId: parent.id,
          }),
        );
      },
      goalById: (id) => treeRef.current.goals.find((goal) => goal.id === id),
      moving,
      setMoving,
      targetsFor: (goalId) => moveTargets(treeRef.current, goalId),
      moveTo: (goalId, target) => {
        const goal = treeRef.current.goals.find((entry) => entry.id === goalId);
        if (!goal) {
          return;
        }
        const parentGoalId = target.startsWith("goal:")
          ? target.slice("goal:".length)
          : null;
        const parentKeyResultId = target.startsWith("kr:")
          ? target.slice("kr:".length)
          : null;
        if (
          parentGoalId === goalId ||
          (parentGoalId === goal.parentGoalId &&
            parentKeyResultId === goal.parentKeyResultId)
        ) {
          return;
        }
        mutate({
          kind: "reparent",
          id: goalId,
          parentGoalId,
          parentKeyResultId,
          from: {
            parentGoalId: goal.parentGoalId,
            parentKeyResultId: goal.parentKeyResultId,
          },
        });
      },
    };
  }, [
    mutate,
    coach,
    canEdit,
    progressMax,
    linkFrom,
    editingTitle,
    toggle,
    cycleId,
    levels,
    queryClient,
    router,
    moving,
  ]);

  /**
   * A card let go among its siblings (P9-T10b): it takes the place its
   * centre is in, saved through the list's own reorder, so the list and the
   * diagram keep one order.
   */
  const placeAmongSiblings = (id: string, slot: number) => {
    const parent = layout.parentOf.get(id);
    const siblings = (
      parent ? (layout.childrenOf.get(parent) ?? []) : []
    ).filter((sibling) => byId.get(sibling)?.kind === "objective");
    const order = tree.goals.map((goal) => goal.id);
    const rest = siblings.filter((sibling) => sibling !== id);
    const current = siblings.indexOf(id);
    if (current === slot || rest.length === 0 || slot < 0) {
      return;
    }
    mutate({
      kind: "placeGoal",
      id,
      afterId: afterForSlot(order, siblings, id, slot),
    });
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
      {okr.failed ? (
        <div
          role="alert"
          data-testid="okr-refused"
          className="flex flex-wrap items-center gap-2 rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          <span className="min-w-0 flex-1">
            {t("okrList.notSaved", { error: okr.failed.error })}
          </span>
          <button
            type="button"
            onClick={okr.discard}
            className="rounded-control px-2 py-0.5 text-ink-3"
          >
            {t("okrList.discard")}
          </button>
        </div>
      ) : null}
      {okr.problem ? (
        <p
          role="alert"
          className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
        >
          {okr.problem}
        </p>
      ) : null}
      {/* An edit made here can meet a change made elsewhere, as one made in
          the list can, and the reader decides which stands rather than
          watching their own quietly roll back. */}
      {okr.conflict ? (
        <div
          role="alert"
          data-testid="okr-conflict"
          className="flex flex-wrap items-center gap-2 rounded-control border border-warn-dot bg-warn-bg px-3 py-2 text-xs text-ink-2"
        >
          <span className="min-w-0 flex-1">
            {t("okrTree.changedSinceYouRead", {
              name: okr.conflict.conflict.changedBy ?? t("okrTree.somebody"),
              value: Object.values(okr.conflict.conflict.current)
                .map((value) => String(value ?? ""))
                .join(", "),
            })}
          </span>
          <Button type="button" size="sm" onClick={okr.keepMine}>
            {t("okrTree.keepMine")}
          </Button>
          <Button type="button" size="sm" onClick={okr.takeTheirs}>
            {t("okrTree.takeTheirs")}
          </Button>
        </div>
      ) : null}
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
          aria-busy={busy}
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
          <DiagramContext.Provider value={shared}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              // A card is removed through the drawer, with its undo, never by
              // a key the canvas would otherwise listen for.
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              // Low enough that thirty company objectives side by side still fit,
              // so every card the budget opens with is drawn rather than cut off.
              minZoom={0.05}
              maxZoom={1.5}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              // Re-parenting (P9-T10b): a card's move handle let go over another
              // card, a key result's row, the annual band or the cycle. Read from
              // what is under the pointer, so a drop anywhere on a card counts.
              onConnectEnd={(event, state) => {
                const from = state.fromNode?.id;
                if (!from || !canEdit) {
                  return;
                }
                const point =
                  "changedTouches" in event ? event.changedTouches[0] : event;
                if (!point) {
                  return;
                }
                const under = document.elementFromPoint(
                  point.clientX,
                  point.clientY,
                );
                const keyResult =
                  under?.closest<HTMLElement>("[data-kr-id]")?.dataset.krId;
                const onto =
                  under?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
                if (!onto || onto === from) {
                  return;
                }
                shared.moveTo(
                  from,
                  keyResult
                    ? `kr:${keyResult}`
                    : onto.startsWith("cycle:")
                      ? "cycle"
                      : `goal:${onto.replace(/^context:/, "")}`,
                );
              }}
              // A card dragged sideways is drawn where the pointer has it, then put
              // among its siblings by its centre when let go.
              onNodesChange={(changes) => {
                for (const change of changes) {
                  if (
                    change.type === "position" &&
                    change.dragging &&
                    change.position
                  ) {
                    setDragged({ id: change.id, ...change.position });
                  }
                }
              }}
              onNodeDragStop={(_event, node) => {
                setDragged(null);
                const parent = layout.parentOf.get(node.id);
                const siblings = (
                  parent ? (layout.childrenOf.get(parent) ?? []) : []
                ).filter((sibling) => sibling !== node.id);
                const centre = node.position.x + (node.width ?? 0) / 2;
                const slot = siblings.filter((sibling) => {
                  const box = byId.get(sibling);
                  return box ? box.x + box.width / 2 < centre : false;
                }).length;
                placeAmongSiblings(node.id, slot);
              }}
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
          </DiagramContext.Provider>
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
        spaces={spaces}
        coach={coach}
      />
    </div>
  );
}
