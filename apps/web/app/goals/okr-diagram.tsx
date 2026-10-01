"use client";

import { Bar, Button, Chip, useTranslations } from "@openokr/ui";
import { useRef, useState } from "react";
import { HealthChip } from "./health-chip.tsx";
import type { EditableGoal } from "./okr-table.tsx";

/**
 * The same cycle drawn rather than listed (S-13, P8-G12).
 *
 * The cycle sits at the top, its objectives hang off it, and each objective's
 * key results chain below it. It answers one question the list cannot: how
 * much of this quarter is carried by how few measures, visible in a glance
 * rather than by scrolling.
 *
 * **Read-only, and that is the whole difference from the list.** Editing in a
 * pannable canvas means a field that moves under the caret, so a card opens
 * its goal instead. The list is where a value is typed.
 *
 * **Laid out in the component, not by a graph library.** The shape is a
 * two-level tree with a fixed column per objective, which is arithmetic rather
 * than a layout problem, and a dependency added for it would be a runtime
 * dependency on every page that loads this route.
 */

const COLUMN = 250;
const COLUMN_GAP = 42;
const ROW_GAP = 18;
const TOP = 150;
const ORIGIN_X = 60;

export function OkrDiagram({
  goals,
  cycleName,
  progressMax,
}: {
  readonly goals: readonly EditableGoal[];
  readonly cycleName: string;
  readonly progressMax: number;
}) {
  const { t } = useTranslations();
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const width = Math.max(
    goals.length * COLUMN + Math.max(goals.length - 1, 0) * COLUMN_GAP,
    320,
  );
  const centre = ORIGIN_X + width / 2;

  const toggle = (id: string) =>
    setCollapsed((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
          <Legend tone="ok" label={t("goals.editor.legendOnTrack")} />
          <Legend tone="warn" label={t("goals.editor.legendCaution")} />
          <Legend tone="bad" label={t("goals.editor.legendOffTrack")} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => setCollapsed(goals.map((goal) => goal.id))}
          >
            {t("goals.editor.collapseAll")}
          </Button>
          <Button type="button" size="sm" onClick={() => setCollapsed([])}>
            {t("goals.editor.expandAll")}
          </Button>
        </div>
      </div>

      <div
        // Panning is a pointer affordance on top of a canvas, and every card
        // inside it is a link. The keyboard reaches the same goals through
        // those links and through the list, so nothing here is reachable by
        // dragging alone.
        className="relative h-136 overflow-auto bg-bg"
        onPointerDown={(event) => {
          dragging.current = {
            x: event.clientX - pan.x,
            y: event.clientY - pan.y,
          };
        }}
        onPointerMove={(event) => {
          const from = dragging.current;
          if (!from) {
            return;
          }
          setPan({ x: event.clientX - from.x, y: event.clientY - from.y });
        }}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerLeave={() => {
          dragging.current = null;
        }}
      >
        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
          <Button
            type="button"
            size="sm"
            aria-label={t("goals.editor.zoomIn")}
            onClick={() => setZoom((current) => Math.min(1.6, current + 0.12))}
          >
            +
          </Button>
          <Button
            type="button"
            size="sm"
            aria-label={t("goals.editor.zoomOut")}
            onClick={() => setZoom((current) => Math.max(0.5, current - 0.12))}
          >
            −
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            {t("goals.editor.fit")}
          </Button>
        </div>

        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
          >
            {goals.map((goal, index) => {
              const x = ORIGIN_X + index * (COLUMN + COLUMN_GAP) + COLUMN / 2;
              return (
                <path
                  key={goal.id}
                  d={`M${centre} 104 V${(104 + TOP) / 2} H${x} V${TOP}`}
                  fill="none"
                  stroke="var(--line-2)"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>

          <div
            className="absolute rounded-lg bg-ink px-5 py-2.5 text-center text-sm font-bold text-surface"
            style={{ left: centre - 95, top: 40, width: 190 }}
          >
            {cycleName}
          </div>

          {goals.map((goal, index) => {
            const x = ORIGIN_X + index * (COLUMN + COLUMN_GAP);
            const open = !collapsed.includes(goal.id);
            return (
              <div key={goal.id}>
                <article
                  className="absolute rounded-lg border border-line border-l-[3px] border-l-brand bg-surface shadow-control"
                  style={{ left: x, top: TOP, width: COLUMN }}
                >
                  <div className="flex items-center gap-2 px-3 pt-2.5">
                    <HealthChip health={goal.health} />
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={t("goals.editor.toggleKeyResults", {
                        title: goal.title,
                      })}
                      onClick={() => toggle(goal.id)}
                      className="ml-auto flex size-5 items-center justify-center rounded-control text-ink-4 hover:bg-raised"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        aria-hidden="true"
                        className={open ? "size-3" : "size-3 -rotate-90"}
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                  </div>
                  <a
                    href={`/goals/${goal.id}`}
                    className="block px-3 pt-2 text-xs font-semibold text-ink hover:underline"
                  >
                    {goal.title}
                  </a>
                  <div className="flex items-center gap-2 px-3 pt-2">
                    <Bar
                      value={goal.progressPct}
                      max={progressMax}
                      label={goal.title}
                      className="flex-1"
                    />
                    <span className="w-9 text-right text-[11px] font-semibold tabular-nums text-ink-3">
                      {Math.round(goal.progressPct)}%
                    </span>
                  </div>
                  <p className="px-3 pb-2.5 pt-2 text-[11px] text-ink-4">
                    {t("goals.editor.keyResultCount", {
                      count: goal.keyResults.length,
                    })}
                  </p>
                </article>

                {open
                  ? goal.keyResults.map((keyResult, position) => (
                      <article
                        key={keyResult.id}
                        className="absolute rounded-lg border border-line border-l-[3px] border-l-line-2 bg-surface shadow-control"
                        style={{
                          left: x,
                          top: TOP + 150 + position * (116 + ROW_GAP),
                          width: COLUMN,
                        }}
                      >
                        <div className="px-3 pt-2.5">
                          <Chip tone="neutral">
                            {Math.round(keyResult.progressPct)}%
                          </Chip>
                        </div>
                        <p className="px-3 pt-2 text-xs text-ink-2">
                          {keyResult.title}
                        </p>
                        <p className="px-3 pt-1.5 text-[11px] tabular-nums text-ink-4">
                          {keyResult.currentValue} / {keyResult.targetValue}
                          {keyResult.unit ? ` ${keyResult.unit}` : ""}
                        </p>
                        <div className="px-3 pb-3 pt-2">
                          <Bar
                            value={keyResult.progressPct}
                            max={progressMax}
                            label={keyResult.title}
                          />
                        </div>
                      </article>
                    ))
                  : null}
              </div>
            );
          })}

          {/* The canvas has to be as tall and as wide as what is on it, or the
           * scroll container clips the last column. */}
          <div
            style={{
              width: width + ORIGIN_X * 2,
              height:
                TOP +
                200 +
                Math.max(
                  0,
                  ...goals.map((goal) =>
                    collapsed.includes(goal.id)
                      ? 0
                      : goal.keyResults.length * (116 + ROW_GAP),
                  ),
                ),
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Legend({
  tone,
  label,
}: {
  readonly tone: "ok" | "warn" | "bad";
  readonly label: string;
}) {
  const colour =
    tone === "ok"
      ? "bg-ok-dot"
      : tone === "warn"
        ? "bg-warn-dot"
        : "bg-bad-dot";
  return (
    <span className="flex items-center gap-1.5">
      <i aria-hidden="true" className={`size-1.5 rounded-full ${colour}`} />
      {label}
    </span>
  );
}
