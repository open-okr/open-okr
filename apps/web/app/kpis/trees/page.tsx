import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import { LaunchRecovery } from "../recovery/launch.tsx";
import { addTree } from "./actions.ts";

/**
 * The KPI driver tree (UIUX-PLAN.md §4 S-18, METHOD.md §6.3, P3-T14).
 *
 * Drawn as an indented tree rather than a free canvas, and that is a decision
 * rather than a shortcut. §6.3's reading rule is "find the unhealthy branch,
 * then find the leading drivers at its edge", which is a question about depth
 * and health, not about where a box sits. An indented tree answers it at a
 * glance, works on a phone, and needs no stored positions to go stale.
 *
 * Two of S-18's features are not here and say so at the foot of the page: the
 * right-hand edit panel, and adding a driver from a node.
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

interface Node {
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
function flatten(nodes: readonly Node[]): { node: Node; depth: number }[] {
  const childrenOf = new Map<string | null, Node[]>();
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
  const out: { node: Node; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const node of childrenOf.get(parent) ?? []) {
      out.push({ node, depth });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default async function KpiTreesPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly tree?: string }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const params = await searchParams;

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;
  const tree = await callAction(context, "kpis.tree", {
    ...(params.tree ? { treeId: params.tree } : {}),
  });
  const rows = flatten(tree.nodes as readonly Node[]);

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">KPI trees</h1>
              <p className="text-xs text-ink-3">
                Each child drives its parent. To move the root, find the
                unhealthy branch and then its leading drivers.
              </p>
            </div>
            <Link
              href="/kpis/recovery"
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              Recovery board
            </Link>
          </CardHeader>
          {tree.trees.length > 0 ? (
            <CardBody className="flex flex-wrap gap-1.5">
              {tree.trees.map((named) => (
                <Link
                  key={named.id}
                  href={`/kpis/trees?tree=${named.id}`}
                  className={
                    named.id === tree.treeId
                      ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                      : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
                  }
                >
                  {named.name}
                </Link>
              ))}
            </CardBody>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {tree.treeId === null
                ? "KPIs in no tree"
                : (tree.trees.find((named) => named.id === tree.treeId)?.name ??
                  "Tree")}
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            {rows.length === 0 ? (
              <p className="p-3 text-sm text-ink-3">
                Nothing in this tree yet. A KPI joins one by being filed into
                it; its parent decides where it hangs.
              </p>
            ) : (
              <ul className="flex flex-col">
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
                    <Bar value={node.achievementPct ?? 0} className="w-24" />
                    <span className="w-12 text-right text-xs text-ink-2 tabular-nums">
                      {node.achievementPct === null
                        ? "no data"
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
                        recovery {Math.round(node.recoveryProgressPct ?? 0)}%
                      </Link>
                    ) : node.state === "unhealthy" && canEdit ? (
                      <LaunchRecovery kpiId={node.id} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {canEdit ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Name a tree</h2>
            </CardHeader>
            <CardBody>
              <ActionForm action={addTree} className="flex flex-col gap-2">
                <label className="sr-only" htmlFor="name">
                  Tree name
                </label>
                <input
                  id="name"
                  name="name"
                  required
                  placeholder="Operating margin"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-4"
                />
                <button
                  type="submit"
                  className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  Name it
                </button>
                <p className="text-xs text-ink-4">
                  A workspace may have several trees. The parent pointers shape
                  one; this names it.
                </p>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Not here yet</h2>
          </CardHeader>
          <CardBody>
            <ul className="flex flex-col gap-1 text-xs text-ink-3">
              <li>
                The right-hand edit panel S-18 describes, and adding a driver
                from a node. Both need a KPI update action, which this task has
                not built: everything here reads.
              </li>
              <li>
                S-21, the KPI detail with the period chart and the formula
                builder. The formula is set through the action today, which is
                where P3-T13 left it.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
