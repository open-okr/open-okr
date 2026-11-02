import { Bar, Chip } from "@openokr/ui";
import Link from "next/link";
import { KPI_ACHIEVEMENT_MAX } from "../../../lib/ceilings.ts";
import { getTranslations } from "../../../lib/translations";
import { LaunchRecovery } from "../recovery/launch.tsx";

/**
 * A driver tree's rows (UIUX-PLAN.md §4 S-18, METHOD.md §6.3).
 *
 * Drawn as an indented tree rather than a free canvas, and that is a decision
 * rather than a shortcut. §6.3's reading rule is "find the unhealthy branch,
 * then find the leading drivers at its edge", which is a question about depth
 * and health, not about where a box sits. An indented tree answers it at a
 * glance, works on a phone, and needs no stored positions to go stale.
 *
 * Moved out of the tree screen at completeness review M-22, because the space
 * home draws a space's trees the same way and a second copy would drift.
 */

const stateTone = (state: string) =>
  state === "healthy"
    ? ("ok" as const)
    : state === "watch"
      ? ("warn" as const)
      : state === "unhealthy"
        ? ("bad" as const)
        : state === "recovering"
          ? ("info" as const)
          : ("neutral" as const);

/**
 * One row's columns: the KPI, its type, its achievement, its health and the
 * two links. On a phone the name and the health share the first line and the
 * bar takes the second (KPI redesign, 2 November 2026).
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_120px_190px_130px_250px]";

export interface KpiTreeNode {
  readonly id: string;
  readonly parentKpiId: string | null;
  readonly title: string;
  readonly unit: string | null;
  readonly indicatorType: string;
  /** Optional (§6.2): null when no tier was chosen. */
  readonly tier: string | null;
  /** The band, or no data (§6.4). */
  readonly state: string;
  /** An open recovery objective, shown beside the band (P9-T17b-a). */
  readonly recovering: boolean;
  readonly achievementPct: number | null;
  readonly effectivePct: number | null;
  readonly healthyPct: number;
  readonly recoveryGoalId: string | null;
  readonly recoveryProgressPct: number | null;
  /** How it drives its parent (§6.3): part of its formula, or believed to move it. */
  readonly link: "formula" | "influence" | null;
}

/** Parents before children, with the depth as a number: the same flattening the
 * Work Map uses, and for the same reason. A nested render would put DOM depth at
 * the mercy of how deep somebody built their tree. */
function flatten(
  nodes: readonly KpiTreeNode[],
): { node: KpiTreeNode; depth: number }[] {
  const childrenOf = new Map<string | null, KpiTreeNode[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    // A node whose parent sits in another tree is drawn at the root here rather
    // than dropped, so nothing disappears because of where it was filed.
    const parent =
      node.parentKpiId && ids.has(node.parentKpiId) ? node.parentKpiId : null;
    const siblings = childrenOf.get(parent);
    if (siblings) {
      siblings.push(node);
    } else {
      childrenOf.set(parent, [node]);
    }
  }
  const out: { node: KpiTreeNode; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const node of childrenOf.get(parent) ?? []) {
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export async function KpiTreeRows({
  nodes,
  canEdit,
  addDriverHref,
  label,
}: {
  readonly nodes: readonly KpiTreeNode[];
  /** Whether the recovery launch is offered on an unhealthy node. */
  readonly canEdit: boolean;
  /**
   * Where "Add driver" goes for a node. Absent means the control is not
   * offered, which is the space home: a driver is added on the tree screen,
   * where the form knows which tree it is filing into.
   */
  readonly addDriverHref?: (nodeId: string) => string;
  /** The list's accessible name, when a page shows more than one tree. */
  readonly label?: string;
}) {
  const { t } = await getTranslations();
  const rows = flatten(nodes);

  return (
    <div>
      {/* The columns named once, on a screen wide enough to have columns. */}
      <div
        aria-hidden="true"
        className={`${ROW_GRID} border-b border-line bg-bg px-3.5 py-1.75 text-[11.5px] font-semibold text-ink-3 max-md:hidden`}
      >
        <span>{t("kpis.grid.kpi")}</span>
        <span>{t("kpis.trees.columnType")}</span>
        <span>{t("kpis.trees.columnAchievement")}</span>
        <span>{t("kpis.trees.columnHealth")}</span>
        <span />
      </div>
      <ul className="flex flex-col" aria-label={label}>
        {rows.map(({ node, depth }) => (
          <li
            key={node.id}
            className={`${ROW_GRID} border-b border-line px-3.5 py-2.5 last:border-b-0 hover:bg-bg max-md:px-3`}
          >
            <span
              className="flex min-w-0 items-center gap-2"
              style={{ paddingLeft: `${Math.max(depth - 1, 0) * 1.25}rem` }}
            >
              {depth > 0 ? (
                <span
                  aria-hidden="true"
                  className="-mt-3 ml-1.5 h-5.5 w-4.5 flex-none rounded-bl-md border-b-[1.5px] border-l-[1.5px] border-line-2"
                />
              ) : null}
              <span className="flex min-w-0 flex-col">
                <span
                  className={`truncate text-ink ${
                    depth === 0
                      ? "text-sm font-bold"
                      : "text-[13px] font-semibold"
                  }`}
                >
                  {node.title}
                  {node.unit ? (
                    <span className="font-medium text-ink-4">
                      {" "}
                      ({node.unit})
                    </span>
                  ) : null}
                </span>
                {node.link ? (
                  <span
                    data-testid="kpi-link"
                    className="text-[11px] text-ink-4"
                  >
                    {node.link === "formula"
                      ? t("kpis.trees.linkFormula")
                      : t("kpis.trees.linkInfluence")}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="max-md:hidden">
              <span
                className={`rounded-[5px] px-1.75 py-px text-[11px] font-semibold ${
                  node.indicatorType === "leading"
                    ? "bg-brand-weak text-brand-text"
                    : "bg-raised text-ink-2"
                }`}
              >
                {node.indicatorType}
                {node.tier ? ` · ${node.tier}` : ""}
              </span>
            </span>
            <span className="flex items-center gap-2 max-md:order-last max-md:col-span-2">
              <Bar
                value={node.achievementPct ?? 0}
                max={KPI_ACHIEVEMENT_MAX}
                className="flex-1"
              />
              <span className="w-11 text-right text-xs font-semibold text-ink-2 tabular-nums">
                {node.achievementPct === null
                  ? t("kpis.trees.noData")
                  : `${Math.round(node.achievementPct)}%`}
              </span>
            </span>
            <span className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
              <Chip tone={stateTone(node.state)} dot>
                {node.state.replace("_", " ")}
              </Chip>
              {node.recovering && node.recoveryGoalId ? (
                <Link
                  href={`/goals/${node.recoveryGoalId}`}
                  className="text-xs font-semibold text-brand-text hover:underline"
                >
                  {t("kpis.trees.recovery", {
                    recoveryProgressPct: Math.round(
                      node.recoveryProgressPct ?? 0,
                    ),
                  })}
                </Link>
              ) : null}
            </span>
            <span className="flex items-center justify-end gap-3 max-md:col-span-2 max-md:justify-start">
              {!node.recovering && node.state === "unhealthy" && canEdit ? (
                <LaunchRecovery kpiId={node.id} size="sm" />
              ) : null}
              <Link
                href={`/kpis/${node.id}`}
                className="text-xs font-medium text-ink-3 hover:text-ink hover:underline"
              >
                {t("common.open")}
              </Link>
              {canEdit && addDriverHref ? (
                <Link
                  href={addDriverHref(node.id)}
                  scroll={false}
                  className="text-xs font-semibold text-brand-text hover:underline"
                >
                  {t("kpis.trees.addDriver")}
                </Link>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
