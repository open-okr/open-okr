import {
  canonThresholds,
  confidenceBand,
  type ResolvedThresholds,
} from "@openokr/method";
import { Avatar, Bar, Card, CardBody, Chip } from "@openokr/ui";
import { HealthChip } from "./goals/health-chip.tsx";
import { QuickCheckIn } from "./quick-check-in.tsx";

/**
 * What a row is, in two letters (S-01's uniform node contract).
 *
 * The mockup writes OBJ and KR. Initiatives and KPI rows join the same column
 * when their tasks land, and the chip is the only place that has to know.
 */
function RowKindChip({ kind }: { readonly kind: "goal" | "key_result" }) {
  return (
    <Chip tone={kind === "goal" ? "brand" : "neutral"}>
      {kind === "goal" ? "OBJ" : "KR"}
    </Chip>
  );
}

/**
 * Confidence as its band and its number (METHOD.md §3.2).
 *
 * The band comes from `packages/method` rather than from a comparison written
 * here, because the boundaries are canon and a second copy of them is how a
 * screen ends up disagreeing with the engine that escalates.
 */
function ConfidenceChip({
  confidence,
  thresholds,
}: {
  readonly confidence: number | null;
  readonly thresholds: ResolvedThresholds;
}) {
  if (confidence === null) {
    return <span className="text-xs text-ink-4">—</span>;
  }
  const verdict = confidenceBand(confidence, thresholds);
  const tone =
    verdict.band === "high" ? "ok" : verdict.band === "medium" ? "warn" : "bad";
  const label =
    verdict.band === "high"
      ? "High"
      : verdict.band === "medium"
        ? "Med"
        : "Low";
  return (
    <Chip tone={tone}>
      {label} {confidence.toFixed(1)}
    </Chip>
  );
}

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
  const thresholds = canonThresholds();

  return (
    <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <Card>
          <CardBody className="p-0">
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
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-line border-b">
                    <th
                      scope="col"
                      className="px-3 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase"
                    >
                      Goal / key result
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase"
                    >
                      Health
                    </th>
                    <th
                      scope="col"
                      className="hidden px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase md:table-cell"
                    >
                      Confidence
                    </th>
                    <th
                      scope="col"
                      className="hidden px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase sm:table-cell"
                    >
                      Progress
                    </th>
                    <th
                      scope="col"
                      className="hidden px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase lg:table-cell"
                    >
                      Next step
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right text-[10px] font-bold tracking-wider text-ink-4 uppercase"
                    >
                      Champion
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => (
                    <tr
                      key={node.id}
                      aria-current={
                        selected?.id === node.id ? "true" : undefined
                      }
                      className={
                        selected?.id === node.id
                          ? "border-line border-b bg-brand-weak last:border-b-0"
                          : "border-line border-b last:border-b-0 hover:bg-raised"
                      }
                    >
                      <th scope="row" className="max-w-0 px-3 py-2 font-normal">
                        <a
                          href={hrefFor(node.id)}
                          className="flex items-center gap-2"
                          style={{ paddingLeft: `${node.depth * 18}px` }}
                        >
                          <RowKindChip kind={node.kind} />
                          <span
                            className={
                              node.kind === "goal"
                                ? "truncate text-sm font-semibold text-ink"
                                : "truncate text-sm text-ink-2"
                            }
                          >
                            {node.title}
                          </span>
                        </a>
                      </th>
                      <td className="px-2 py-2">
                        <HealthChip health={node.health} />
                      </td>
                      <td className="hidden px-2 py-2 md:table-cell">
                        <ConfidenceChip
                          confidence={node.confidence}
                          thresholds={thresholds}
                        />
                      </td>
                      <td className="hidden px-2 py-2 sm:table-cell">
                        <span className="flex items-center gap-2">
                          <Bar
                            value={node.progressPct}
                            className="h-1.5 w-20 lg:w-28"
                          />
                          <span className="w-9 text-right text-xs font-semibold tabular-nums text-ink-3">
                            {Math.round(node.progressPct)}%
                          </span>
                        </span>
                      </td>
                      <td className="hidden max-w-[16rem] px-2 py-2 lg:table-cell">
                        <span className="block truncate text-xs text-ink-3">
                          {node.nextStep}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex justify-end">
                          <Avatar name={node.owner} size="sm" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
