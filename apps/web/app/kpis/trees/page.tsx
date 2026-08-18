import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { KPI_TABS, SectionTabs } from "../../../lib/section-tabs.tsx";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import { LaunchRecovery } from "../recovery/launch.tsx";
import { addDriver, addTree, fileIntoTree } from "./actions.ts";

/**
 * The KPI driver tree (UIUX-PLAN.md §4 S-18, METHOD.md §6.3, P3-T14).
 *
 * Drawn as an indented tree rather than a free canvas, and that is a decision
 * rather than a shortcut. §6.3's reading rule is "find the unhealthy branch,
 * then find the leading drivers at its edge", which is a question about depth
 * and health, not about where a box sits. An indented tree answers it at a
 * glance, works on a phone, and needs no stored positions to go stale.
 *
 * Adding a driver hangs off the node it will drive: the link carries the parent
 * in the URL, so the form always knows what the new KPI is meant to move.
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
  readonly searchParams: Promise<{
    readonly tree?: string;
    readonly under?: string;
  }>;
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
  // `?tree=none` is the KPIs in no tree at all. Without it, naming one tree
  // would hide every unfiled KPI and there would be nothing left to file.
  const tree = await callAction(context, "kpis.tree", {
    ...(params.tree === "none"
      ? { treeId: null }
      : params.tree
        ? { treeId: params.tree }
        : {}),
  });
  const rows = flatten(tree.nodes as readonly Node[]);
  // Only the filing control needs this, and only while a named tree is empty.
  const unfiled =
    tree.treeId !== null && tree.nodes.length === 0
      ? (await callAction(context, "kpis.tree", { treeId: null })).nodes
      : [];

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3.5">
        <SectionTabs items={KPI_TABS} active="/kpis/trees" />
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">KPI trees</h1>
              <p className="text-xs text-ink-3">
                Each child drives its parent. To move the root, find the
                unhealthy branch and then its leading drivers.
              </p>
            </div>
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
              <Link
                href="/kpis/trees?tree=none"
                className={
                  tree.treeId === null
                    ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                    : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
                }
              >
                No tree
              </Link>
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
                    <Link
                      href={`/kpis/${node.id}`}
                      className="text-xs text-ink-3 hover:underline"
                    >
                      open
                    </Link>
                    {canEdit ? (
                      <Link
                        href={`/kpis/trees?${new URLSearchParams({
                          // Carried so the form returns to the view it was
                          // opened from, including the unfiled one.
                          tree: tree.treeId ?? "none",
                          under: node.id,
                        }).toString()}`}
                        className="text-xs font-semibold text-brand-text hover:underline"
                      >
                        add driver
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {canEdit && params.under ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                Add a driver under{" "}
                {tree.nodes.find((node) => node.id === params.under)?.title ??
                  "this KPI"}
              </h2>
            </CardHeader>
            <CardBody>
              <ActionForm action={addDriver} className="flex flex-col gap-2">
                <input type="hidden" name="parentKpiId" value={params.under} />
                <input type="hidden" name="treeId" value={tree.treeId ?? ""} />
                <label className="sr-only" htmlFor="driver-title">
                  What the driver measures
                </label>
                <input
                  id="driver-title"
                  name="title"
                  required
                  placeholder="Qualified leads"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink placeholder:text-ink-4"
                />
                <div className="flex flex-wrap items-center gap-2.5">
                  <label className="text-xs text-ink-3" htmlFor="indicatorType">
                    Indicator
                  </label>
                  <select
                    id="indicatorType"
                    name="indicatorType"
                    defaultValue="leading"
                    className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                  >
                    <option value="leading">leading</option>
                    <option value="lagging">lagging</option>
                  </select>
                  <label className="text-xs text-ink-3" htmlFor="driver-freq">
                    Frequency
                  </label>
                  <select
                    id="driver-freq"
                    name="frequency"
                    defaultValue="monthly"
                    className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                  >
                    <option value="daily">daily</option>
                    <option value="weekly">weekly</option>
                    <option value="monthly">monthly</option>
                    <option value="quarterly">quarterly</option>
                    <option value="yearly">yearly</option>
                  </select>
                  <label className="text-xs text-ink-3" htmlFor="driver-dir">
                    Better when
                  </label>
                  <select
                    id="driver-dir"
                    name="direction"
                    defaultValue="higher_better"
                    className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                  >
                    <option value="higher_better">higher</option>
                    <option value="lower_better">lower</option>
                  </select>
                  <label className="text-xs text-ink-3" htmlFor="driver-target">
                    Standing target
                  </label>
                  <input
                    id="driver-target"
                    name="targetDefault"
                    type="number"
                    step="any"
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                  >
                    Add the driver
                  </button>
                  <Link
                    href={`/kpis/trees?tree=${tree.treeId ?? "none"}`}
                    className="text-xs text-ink-3 hover:underline"
                  >
                    Cancel
                  </Link>
                </div>
                <p className="text-xs text-ink-4">
                  A leading driver is something a team can act on this week,
                  which is what makes it a candidate for a recovery key result.
                  It joins this tree automatically.
                </p>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        {canEdit && tree.treeId !== null && tree.nodes.length === 0 ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                File a KPI into this tree
              </h2>
            </CardHeader>
            <CardBody>
              <ActionForm action={fileIntoTree} className="flex flex-col gap-2">
                <input type="hidden" name="treeId" value={tree.treeId} />
                <label className="sr-only" htmlFor="kpiId">
                  Which KPI
                </label>
                <select
                  id="kpiId"
                  name="kpiId"
                  required
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  {unfiled.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  File it
                </button>
                <p className="text-xs text-ink-4">
                  The root goes in first. Everything under it joins as its
                  drivers are added.
                </p>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

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
                The right-hand panel S-18 describes, which edits the selected
                KPI in place. The fields are all editable through the KPI
                detail, so this is a second surface for the same action rather
                than missing capability.
              </li>
              <li>
                Dragging a node onto a new parent. Re-parenting works through
                the detail page; the canvas gesture does not exist.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
