import {
  canonThresholds,
  confidenceBand,
  type ResolvedTerminology,
  type ResolvedThresholds,
  TERMINOLOGY,
} from "@openokr/method";
import {
  Avatar,
  Bar,
  Card,
  CardBody,
  Chip,
  type ConfidenceDisplay,
  formatConfidence,
  type MessageValues,
} from "@openokr/ui";
import type { ReactNode } from "react";
import { progressCeiling } from "../lib/ceilings.ts";
import { confidenceDisplay } from "../lib/confidence-display.ts";
import { workspaceTerminology } from "../lib/terminology.ts";
import { getTranslations } from "../lib/translations";
import { HealthChip } from "./goals/health-chip.tsx";
import { QuickCheckIn } from "./quick-check-in.tsx";

/**
 * What a row is, abbreviated to fit the column (S-01's uniform node contract).
 *
 * The mockup writes OBJ and KR for the canon terms. A workspace that renames
 * Objective still gets an abbreviation, built from its own word rather than
 * the canon's, so the renamed screens are not the one place still abbreviating
 * the word nobody kept.
 *
 * A single word is its own first three letters (Objective -> OBJ, Goal ->
 * GOA). A multi-word term takes one letter per word instead, which is what
 * makes the canon's own "Key result" read as KR rather than KEY.
 */
export function rowKindAbbreviation(
  kind: "goal" | "key_result",
  terms: ResolvedTerminology,
): string {
  const word =
    kind === "goal" ? terms.objective.singular : terms.keyResult.singular;
  const parts = word.trim().split(/\s+/);
  return (
    parts.length > 1 ? parts.map((part) => part[0]).join("") : word.slice(0, 3)
  )
    .slice(0, 3)
    .toUpperCase();
}

/**
 * The chip's text for each kind of row, worked out once per table rather than
 * once per row.
 *
 * A term the workspace kept reads the catalogue's own abbreviation, so a
 * translator still owns it (M-15). A renamed one is abbreviated from the
 * workspace's word, which is one pair of words in every language (M-14), so
 * there is nothing to translate. Only the singular is compared, because it is
 * the only word the abbreviation is built from.
 */
function rowKindLabels(
  terms: ResolvedTerminology,
  t: (key: string, values?: MessageValues) => string,
): Readonly<Record<"goal" | "key_result", string>> {
  return {
    goal:
      terms.objective.singular === TERMINOLOGY.objective.singular
        ? t("workMap.obj")
        : rowKindAbbreviation("goal", terms),
    key_result:
      terms.keyResult.singular === TERMINOLOGY.keyResult.singular
        ? t("workMap.kr")
        : rowKindAbbreviation("key_result", terms),
  };
}

function RowKindChip({
  kind,
  label,
}: {
  readonly kind: "goal" | "key_result";
  readonly label: string;
}) {
  return <Chip tone={kind === "goal" ? "brand" : "neutral"}>{label}</Chip>;
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
  t,
  display,
}: {
  readonly confidence: number | null;
  readonly thresholds: ResolvedThresholds;
  /** The workspace's "Confidence shown as" (guided-inputs §4.8). */
  readonly display: ConfidenceDisplay;
  /** The caller's `t`, so a row does not resolve the locale once per row. */
  readonly t: (key: string, values?: MessageValues) => string;
}) {
  if (confidence === null) {
    return <span className="text-xs text-ink-4">—</span>;
  }
  const verdict = confidenceBand(confidence, thresholds);
  const tone =
    verdict.band === "high" ? "ok" : verdict.band === "medium" ? "warn" : "bad";
  const value = { confidence: formatConfidence(confidence, display, t) };
  const label =
    verdict.band === "high"
      ? t("workMap.confidenceHigh", value)
      : verdict.band === "medium"
        ? t("workMap.confidenceMed", value)
        : t("workMap.confidenceLow", value);
  return <Chip tone={tone}>{label}</Chip>;
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
  /**
   * Something true of this row rather than of the goal. The explorer says a
   * parent is outside the current filter with it; nothing else sets one yet.
   */
  readonly note?: string;
}

/**
 * The goal rows, as `01-work-map` draws them: one table, a row per objective
 * and per key result, indented by what each one supports.
 *
 * Split out of `WorkMap` so the goals explorer wears the same treatment rather
 * than a second one. S-13 has no mockup of its own, and §10 makes an undrawn
 * detail's mockup value the proposed default, so the explorer stopped drawing a
 * card per goal from the same action and the same data.
 *
 * `empty` belongs to the caller: the two screens are empty for different
 * reasons and each one knows what to suggest next.
 */
export async function GoalTable({
  nodes,
  selected,
  rowHref,
  empty,
}: {
  readonly nodes: readonly MapNode[];
  readonly selected: MapNode | null;
  /**
   * Where a row points. Takes the node rather than its id, because a key
   * result row has to link to the goal it belongs to and only the node carries
   * both.
   */
  readonly rowHref: (node: MapNode) => string;
  readonly empty: ReactNode;
}) {
  const { t } = await getTranslations();
  // P8-G04. A bar drawn on a 0-to-100 track under a raised ceiling fills
  // early and tells a screen reader 100 is the most there is.
  const ceiling = await progressCeiling();
  const rowKind = rowKindLabels(await workspaceTerminology(), t);

  const thresholds = canonThresholds();
  const display = await confidenceDisplay();

  return (
    <Card>
      <CardBody className="p-0">
        {nodes.length === 0 ? (
          empty
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-line border-b">
                <th
                  scope="col"
                  className="px-3 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase"
                >
                  {t("workMap.goalKeyResult")}
                </th>
                <th
                  scope="col"
                  className="px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase"
                >
                  {t("workMap.health")}
                </th>
                <th
                  scope="col"
                  className="hidden px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase md:table-cell"
                >
                  {t("common.confidence")}
                </th>
                <th
                  scope="col"
                  className="hidden px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase sm:table-cell"
                >
                  {t("common.progress")}
                </th>
                <th
                  scope="col"
                  className="hidden px-2 py-2 text-[10px] font-bold tracking-wider text-ink-4 uppercase lg:table-cell"
                >
                  {t("workMap.nextStep")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right text-[10px] font-bold tracking-wider text-ink-4 uppercase"
                >
                  {t("common.champion")}
                </th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr
                  key={node.id}
                  aria-current={selected?.id === node.id ? "true" : undefined}
                  className={
                    selected?.id === node.id
                      ? "border-line border-b bg-brand-weak last:border-b-0"
                      : "border-line border-b last:border-b-0 hover:bg-raised"
                  }
                >
                  <th scope="row" className="max-w-0 px-3 py-2 font-normal">
                    <a
                      href={rowHref(node)}
                      className="flex items-center gap-2"
                      style={{ paddingLeft: `${node.depth * 18}px` }}
                    >
                      <RowKindChip
                        kind={node.kind}
                        label={rowKind[node.kind]}
                      />
                      <span
                        className={
                          node.kind === "goal"
                            ? "truncate text-sm font-semibold text-ink"
                            : "truncate text-sm text-ink-2"
                        }
                      >
                        {node.title}
                      </span>
                      {node.note ? (
                        <Chip tone="info" className="flex-none">
                          {node.note}
                        </Chip>
                      ) : null}
                    </a>
                  </th>
                  <td className="px-2 py-2">
                    <HealthChip health={node.health} />
                  </td>
                  <td className="hidden px-2 py-2 md:table-cell">
                    <ConfidenceChip
                      confidence={node.confidence}
                      thresholds={thresholds}
                      t={t}
                      display={display}
                    />
                  </td>
                  <td className="hidden px-2 py-2 sm:table-cell">
                    <span className="flex items-center gap-2">
                      <Bar
                        value={node.progressPct}
                        max={ceiling}
                        label={node.title}
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
  );
}

export async function WorkMap({
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
  const { t } = await getTranslations();
  const ceiling = await progressCeiling();

  return (
    <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start">
      {/* The first stop of the first-visit tour (L-08) outlines this. */}
      <div className="min-w-0 flex-1" data-tour-target="work-map">
        <GoalTable
          nodes={nodes}
          selected={selected}
          rowHref={(node) => hrefFor(node.id)}
          empty={
            <div className="flex flex-col gap-1.5 p-3">
              <p className="text-sm text-ink-2">
                {t("workMap.nothingInThisCycle")}
              </p>
              <p className="text-xs text-ink-3">
                {t("workMap.objectivesAreDraftedIn")}{" "}
                <a className="underline" href="/cycle?phase=4">
                  {t("workMap.startDrafting")}
                </a>
                .
              </p>
            </div>
          }
        />
      </div>

      {selected ? (
        <aside className="w-full flex-none lg:w-80">
          <Card>
            <CardBody className="flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-bold text-ink">{selected.title}</h2>
                <a
                  href={hrefFor(null)}
                  aria-label={t("workMap.closeThePanel")}
                  className="text-xs text-ink-3 hover:text-ink"
                >
                  ✕
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone="neutral">
                  {selected.kind === "goal"
                    ? t("workMap.objective")
                    : t("workMap.keyResult")}
                </Chip>
                <HealthChip health={selected.health} />
              </div>
              <div className="flex items-center gap-2">
                <Bar
                  value={selected.progressPct}
                  max={ceiling}
                  label={selected.title}
                  className="h-1.5 flex-1"
                />
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
                {t("workMap.openTheGoal")}
              </a>
            </CardBody>
          </Card>
        </aside>
      ) : null}
    </div>
  );
}
