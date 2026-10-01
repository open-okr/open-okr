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

export interface KpiTreeNode {
  readonly id: string;
  readonly parentKpiId: string | null;
  readonly title: string;
  readonly unit: string | null;
  readonly indicatorType: string;
  readonly tier: string;
  readonly state: string;
  readonly achievementPct: number | null;
  readonly effectivePct: number | null;
  readonly healthyPct: number;
  readonly recoveryGoalId: string | null;
  readonly recoveryProgressPct: number | null;
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
    <ul className="flex flex-col" aria-label={label}>
      {rows.map(({ node, depth }) => (
        <li
          key={node.id}
          className="flex flex-wrap items-center gap-2 border-line border-b px-3 py-2 last:border-b-0"
          style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
        >
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {node.title}
            {node.unit ? (
              <span className="text-ink-4"> ({node.unit})</span>
            ) : null}
          </span>
          <span className="text-xs text-ink-4">
            {node.indicatorType} · {node.tier}
          </span>
          <Bar
            value={node.achievementPct ?? 0}
            max={KPI_ACHIEVEMENT_MAX}
            className="w-24"
          />
          <span className="w-12 text-right text-xs text-ink-2 tabular-nums">
            {node.achievementPct === null
              ? t("kpis.trees.noData")
              : `${Math.round(node.achievementPct)}%`}
          </span>
          <Chip tone={stateTone(node.state)} dot>
            {node.state}
          </Chip>
          {node.recoveryGoalId ? (
            <Link
              href={`/goals/${node.recoveryGoalId}`}
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              {t("kpis.trees.recovery", {
                recoveryProgressPct: Math.round(node.recoveryProgressPct ?? 0),
              })}
            </Link>
          ) : node.state === "unhealthy" && canEdit ? (
            <LaunchRecovery kpiId={node.id} />
          ) : null}
          <Link
            href={`/kpis/${node.id}`}
            className="text-xs text-ink-3 hover:underline"
          >
            {t("common.open")}
          </Link>
          {canEdit && addDriverHref ? (
            <Link
              href={addDriverHref(node.id)}
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              {t("kpis.trees.addDriver")}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
