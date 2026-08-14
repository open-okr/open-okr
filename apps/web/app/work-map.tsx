import { Bar, Card, CardBody, Chip } from "@openokr/ui";
import { HealthChip } from "./goals/health-chip.tsx";
import { QuickCheckIn } from "./quick-check-in.tsx";

/**
 * The Work Map's tree and its side panel (UIUX-PLAN.md §4 S-01, P3-T11).
 *
 * **One node contract for every row.** A goal, a sub-goal and a key result all
 * render through the same shape: health including staleness, progress,
 * confidence, who owns it, the timeframe and the next step. That uniformity is
 * the point of the screen. Initiatives and tasks join the same contract in
 * Phase 5 without the row component changing.
 *
 * The tree is rendered flat and indented rather than nested, so a deep tree
 * cannot nest the DOM deep enough to matter and every row is a sibling for
 * virtualisation later. With the tree flattened server-side, "collapse" is a
 * filter over the flat list rather than a recursive walk.
 */

export interface MapNode {
  readonly id: string;
  readonly kind: "goal" | "key_result";
  readonly title: string;
  readonly depth: number;
  readonly owner: string;
  readonly health: string;
  readonly progressPct: number;
  readonly confidence: number | null;
  readonly timeframe: string | null;
  /** What happens next: the due date, or what the row is waiting for. */
  readonly nextStep: string;
  /** The goal this row belongs to, which is what the side panel opens. */
  readonly goalId: string;
  /** Set on a key result row, so the panel can offer a value to record. */
  readonly keyResultId: string | null;
  readonly currentValue: number | null;
  readonly unit: string | null;
}

export function WorkMap({
  nodes,
  selected,
  canEdit,
  hrefFor,
}: {
  readonly nodes: readonly MapNode[];
  readonly selected: MapNode | null;
  readonly canEdit: boolean;
  /** Deep links every node, so a row is a URL somebody can send. */
  readonly hrefFor: (nodeId: string | null) => string;
}) {
  return (
    <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <Card>
          <CardBody className="p-1.5">
            {nodes.length === 0 ? (
              <div className="flex flex-col gap-1.5 p-3">
                <p className="text-sm text-ink-2">Nothing in this cycle yet.</p>
                <p className="text-xs text-ink-3">
                  Objectives are drafted in phase 4 of the cycle workspace,
                  where every rule is checked as they are written.{" "}
                  <a className="underline" href="/cycle?phase=4">
                    Start drafting
                  </a>
                  .
                </p>
              </div>
            ) : (
              <ul className="flex flex-col">
                {nodes.map((node) => (
                  <li key={node.id}>
                    <a
                      href={hrefFor(node.id)}
                      aria-current={
                        selected?.id === node.id ? "true" : undefined
                      }
                      style={{ paddingLeft: `${8 + node.depth * 18}px` }}
                      className={
                        selected?.id === node.id
                          ? "flex items-center gap-2.5 rounded-md bg-brand-weak py-1.5 pr-2.5"
                          : "flex items-center gap-2.5 rounded-md py-1.5 pr-2.5 hover:bg-raised"
                      }
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-1.5">
                          {node.kind === "key_result" ? (
                            <span
                              aria-hidden="true"
                              className="text-xs text-ink-4"
                            >
                              ↳
                            </span>
                          ) : null}
                          <span className="truncate text-sm text-ink">
                            {node.title}
                          </span>
                        </span>
                        <span className="truncate text-xs text-ink-3">
                          {node.owner} · {node.nextStep}
                          {node.timeframe ? ` · ${node.timeframe}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-none items-center gap-2.5">
                        <Bar
                          value={node.progressPct}
                          className="hidden h-1.5 w-24 sm:block"
                        />
                        <span className="w-9 text-right text-xs font-semibold text-ink-3">
                          {Math.round(node.progressPct)}%
                        </span>
                        {node.confidence !== null ? (
                          <span className="hidden w-8 text-right text-xs text-ink-4 md:block">
                            {node.confidence.toFixed(1)}
                          </span>
                        ) : (
                          <span className="hidden w-8 md:block" />
                        )}
                        <HealthChip health={node.health} />
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {selected ? (
        <aside className="w-full flex-none lg:w-80">
          <Card>
            <CardBody className="flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-bold text-ink">{selected.title}</h2>
                <a
                  href={hrefFor(null)}
                  aria-label="Close the panel"
                  className="text-xs text-ink-3 hover:text-ink"
                >
                  ✕
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone="neutral">
                  {selected.kind === "goal" ? "objective" : "key result"}
                </Chip>
                <HealthChip health={selected.health} />
              </div>
              <div className="flex items-center gap-2">
                <Bar value={selected.progressPct} className="h-1.5 flex-1" />
                <span className="text-xs font-semibold text-ink-3">
                  {Math.round(selected.progressPct)}%
                </span>
              </div>
              <p className="text-xs text-ink-3">
                {selected.owner} · {selected.nextStep}
              </p>

              {selected.keyResultId && canEdit ? (
                <QuickCheckIn
                  goalId={selected.goalId}
                  keyResultId={selected.keyResultId}
                  currentValue={selected.currentValue ?? 0}
                  unit={selected.unit}
                />
              ) : null}

              <a
                className="text-xs text-brand-text underline"
                href={`/goals/${selected.goalId}`}
              >
                Open the goal
              </a>
            </CardBody>
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
