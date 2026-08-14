"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  layoutCascade,
  ROW_GAP,
  visibleCards,
} from "./geometry.ts";

/**
 * The alignment studio canvas (UIUX-PLAN.md §4 S-16, P3-T10).
 *
 * The cascade drawn as cards on a plane: one row per level, vertical connectors
 * for the parent pointer, dashed connectors for horizontal dependencies. Pan by
 * dragging, zoom with the controls or the wheel, traverse with the keyboard.
 *
 * **Layout is computed, never stored.** There are no node coordinates in the
 * database and there must not be: a saved position is a second thing to keep in
 * step with the tree, and it goes stale the moment somebody re-parents a goal.
 * The tree decides where a card sits, every time.
 *
 * **Virtualisation is by viewport intersection, not by windowing a list.** A
 * canvas has two axes, so a row window would still draw every card in a wide
 * level. Only cards whose rectangle meets the visible rectangle are rendered;
 * connectors are drawn for edges with at least one visible end, so a line never
 * stops in mid-air at the edge of the screen.
 *
 * **Keyboard traverse reaches every node, including the ones off screen.** The
 * arrow keys move within and between levels over the full ordered list rather
 * than over what happens to be drawn, and selecting a card scrolls it into view.
 * A canvas only a mouse can reach is a canvas half the organisation cannot use.
 */

export interface StudioNode {
  readonly id: string;
  readonly title: string;
  readonly level: string;
  readonly owner: string;
  readonly parentGoalId: string | null;
  readonly keyResultCount: number;
  readonly dependencyCount: number;
  readonly health: string;
  readonly progressPct: number;
  readonly unaligned: boolean;
  readonly closed: boolean;
}

export interface StudioEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

const HEALTH_COLOUR: Readonly<Record<string, string>> = {
  on_track: "bg-ok",
  achieved: "bg-ok",
  caution: "bg-warn",
  outdated: "bg-warn",
  off_track: "bg-bad",
  missed: "bg-bad",
  pending: "bg-line-2",
};

export function Canvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  linkMode,
  onLink,
}: {
  readonly nodes: readonly StudioNode[];
  readonly edges: readonly StudioEdge[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly linkMode: boolean;
  readonly onLink: (fromId: string, toId: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [viewport, setViewport] = useState({ width: 1200, height: 700 });
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);

  const { placed, width, height } = useMemo(
    () => layoutCascade([...nodes]),
    [nodes],
  );
  const positions = useMemo(
    () => new Map(placed.map((entry) => [entry.node.id, entry])),
    [placed],
  );

  // The ordered list the keyboard walks. Every node, drawn or not.
  const order = useMemo(() => placed.map((entry) => entry.node.id), [placed]);

  const measure = useCallback((element: HTMLDivElement | null) => {
    frame.current = element;
    if (element) {
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    }
  }, []);

  const visible = useMemo(
    () =>
      visibleCards(placed, {
        panX: pan.x,
        panY: pan.y,
        zoom,
        width: viewport.width,
        height: viewport.height,
      }),
    [placed, pan, zoom, viewport],
  );

  const visibleIds = useMemo(
    () => new Set(visible.map((entry) => entry.node.id)),
    [visible],
  );

  /** Brings a card into view, so a keyboard user never selects something invisible. */
  const reveal = useCallback(
    (id: string) => {
      const entry = positions.get(id);
      if (!entry) {
        return;
      }
      setPan((current) => {
        const x = entry.x * zoom + current.x;
        const y = entry.y * zoom + current.y;
        let nextX = current.x;
        let nextY = current.y;
        if (x < 40) {
          nextX = current.x - x + 40;
        } else if (x + CARD_WIDTH * zoom > viewport.width - 40) {
          nextX = current.x - (x + CARD_WIDTH * zoom - viewport.width + 40);
        }
        if (y < 40) {
          nextY = current.y - y + 40;
        } else if (y + CARD_HEIGHT * zoom > viewport.height - 40) {
          nextY = current.y - (y + CARD_HEIGHT * zoom - viewport.height + 40);
        }
        return { x: nextX, y: nextY };
      });
      // Focus follows selection, so the next arrow key still reaches this
      // component and a screen reader announces the card that was moved to.
      // Deferred a frame because the card may not have been drawn until the pan
      // above brought it into the visible rectangle.
      requestAnimationFrame(() => {
        document.getElementById(`studio-node-${id}`)?.focus();
      });
    },
    [positions, zoom, viewport],
  );

  const select = useCallback(
    (id: string) => {
      onSelect(id);
      reveal(id);
    },
    [onSelect, reveal],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (order.length === 0) {
        return;
      }
      const index = selectedId ? order.indexOf(selectedId) : -1;
      const current = selectedId ? positions.get(selectedId) : undefined;

      // Left and right walk the drawn order, which is the reading order of the
      // level. Up and down move between levels, landing on the nearest card
      // horizontally rather than on whatever shares an index.
      const step = (delta: number): void => {
        const next =
          order[Math.min(order.length - 1, Math.max(0, index + delta))];
        if (next) {
          select(next);
        }
      };
      const vertical = (delta: number): void => {
        if (!current) {
          const first = order[0];
          if (first) {
            select(first);
          }
          return;
        }
        const targetY = current.y + delta * (CARD_HEIGHT + ROW_GAP);
        const candidates = placed.filter(
          (entry) => Math.abs(entry.y - targetY) < 1,
        );
        if (candidates.length === 0) {
          return;
        }
        const nearest = candidates.reduce((best, entry) =>
          Math.abs(entry.x - current.x) < Math.abs(best.x - current.x)
            ? entry
            : best,
        );
        select(nearest.node.id);
      };

      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          step(index < 0 ? 1 : 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          step(index < 0 ? 0 : -1);
          break;
        case "ArrowDown":
          event.preventDefault();
          vertical(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          vertical(-1);
          break;
        case "Home": {
          event.preventDefault();
          const first = order[0];
          if (first) {
            select(first);
          }
          break;
        }
        case "End": {
          event.preventDefault();
          const last = order[order.length - 1];
          if (last) {
            select(last);
          }
          break;
        }
        default:
          break;
      }
    },
    [order, selectedId, positions, placed, select],
  );

  const clickNode = useCallback(
    (id: string) => {
      if (!linkMode) {
        select(id);
        return;
      }
      if (linkFrom === null) {
        setLinkFrom(id);
        select(id);
        return;
      }
      if (linkFrom === id) {
        // Clicking the same card twice cancels rather than making a self-link
        // the database would refuse anyway.
        setLinkFrom(null);
        return;
      }
      onLink(linkFrom, id);
      setLinkFrom(null);
    },
    [linkMode, linkFrom, onLink, select],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-3">
          {nodes.length} node{nodes.length === 1 ? "" : "s"}, {visible.length}{" "}
          drawn
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(0.3, value - 0.15))}
            className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-raised"
          >
            Zoom out
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(1.6, value + 0.15))}
            className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-raised"
          >
            Zoom in
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setPan({ x: 24, y: 24 });
            }}
            className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-raised"
          >
            Reset
          </button>
          <span className="text-xs text-ink-4">{Math.round(zoom * 100)}%</span>
        </span>
        {linkMode ? (
          <span className="rounded-md bg-brand-weak px-2 py-0.5 text-xs font-semibold text-brand-text">
            {linkFrom
              ? "Now click the goal it depends on"
              : "Click the first goal"}
          </span>
        ) : null}
      </div>

      {/* No `tabIndex` on this container, deliberately. The cards are real
          buttons, so Tab already reaches the cascade and a key event bubbles up
          from whichever card holds focus. A focusable wrapper around focusable
          children is a second tab stop that does nothing. */}
      <div
        ref={measure}
        role="application"
        aria-label="Alignment cascade"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          dragging.current = {
            x: event.clientX - pan.x,
            y: event.clientY - pan.y,
          };
        }}
        onPointerMove={(event) => {
          const start = dragging.current;
          if (!start) {
            return;
          }
          setPan({ x: event.clientX - start.x, y: event.clientY - start.y });
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerLeave={() => {
          dragging.current = null;
        }}
        className="relative h-[560px] w-full cursor-grab overflow-hidden rounded-lg border border-line bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-strong"
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: `${width}px`,
            height: `${height}px`,
          }}
          className="absolute top-0 left-0"
        >
          <svg
            width={width}
            height={height}
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0"
          >
            <title>Connectors</title>
            {placed.map((entry) => {
              const parent = entry.node.parentGoalId
                ? positions.get(entry.node.parentGoalId)
                : undefined;
              if (!parent) {
                return null;
              }
              // Drawn when either end is visible, so a line never stops in
              // mid-air at the edge of the viewport.
              if (
                !visibleIds.has(entry.node.id) &&
                !visibleIds.has(parent.node.id)
              ) {
                return null;
              }
              const x1 = parent.x + CARD_WIDTH / 2;
              const y1 = parent.y + CARD_HEIGHT;
              const x2 = entry.x + CARD_WIDTH / 2;
              const y2 = entry.y;
              const mid = (y1 + y2) / 2;
              return (
                <path
                  key={`v-${entry.node.id}`}
                  d={`M ${x1} ${y1} L ${x1} ${mid} L ${x2} ${mid} L ${x2} ${y2}`}
                  className="stroke-line-2"
                  strokeWidth={1.5}
                  fill="none"
                />
              );
            })}
            {edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) {
                return null;
              }
              if (!visibleIds.has(edge.from) && !visibleIds.has(edge.to)) {
                return null;
              }
              return (
                <line
                  key={`h-${edge.id}`}
                  x1={from.x + CARD_WIDTH / 2}
                  y1={from.y + CARD_HEIGHT / 2}
                  x2={to.x + CARD_WIDTH / 2}
                  y2={to.y + CARD_HEIGHT / 2}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  className="stroke-brand-strong"
                />
              );
            })}
          </svg>

          {visible.map((entry) => (
            <button
              key={entry.node.id}
              id={`studio-node-${entry.node.id}`}
              type="button"
              onClick={() => clickNode(entry.node.id)}
              aria-pressed={entry.node.id === selectedId}
              style={{
                left: `${entry.x}px`,
                top: `${entry.y}px`,
                width: `${CARD_WIDTH}px`,
                height: `${CARD_HEIGHT}px`,
              }}
              className={
                entry.node.id === selectedId
                  ? "absolute flex flex-col justify-between rounded-lg border-2 border-brand bg-surface p-2 text-left shadow-brand"
                  : "absolute flex flex-col justify-between rounded-lg border border-line bg-surface p-2 text-left hover:border-ink-4"
              }
            >
              <span className="flex items-start justify-between gap-1.5">
                <span className="line-clamp-2 text-xs font-semibold text-ink">
                  {entry.node.title}
                </span>
                <span
                  aria-hidden="true"
                  className={`mt-0.5 size-2 flex-none rounded-full ${
                    HEALTH_COLOUR[entry.node.health] ?? "bg-line-2"
                  }`}
                />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="truncate text-[10.5px] text-ink-3">
                  {entry.node.level} · {entry.node.owner}
                </span>
                <span className="flex items-center gap-1.5 text-[10.5px] text-ink-4">
                  <span>
                    {entry.node.keyResultCount} KR
                    {entry.node.keyResultCount === 1 ? "" : "s"}
                  </span>
                  <span>·</span>
                  <span>{entry.node.dependencyCount} dep</span>
                  {entry.node.unaligned ? (
                    <span className="rounded bg-bad-bg px-1 font-semibold text-bad">
                      unaligned
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          ))}
        </div>

        {nodes.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-3">
            No goals in this cycle yet.
          </p>
        ) : null}
      </div>
      <p className="text-xs text-ink-4">
        Drag to pan. Arrow keys move between goals, Home and End jump to the
        ends of the cascade. Every goal is reachable by keyboard, including the
        ones currently off screen.
      </p>
    </div>
  );
}
