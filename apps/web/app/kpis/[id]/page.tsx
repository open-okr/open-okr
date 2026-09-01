import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { requireWorkspace } from "../../../lib/workspace";
import { FormulaBuilder } from "./formula-builder.tsx";

/**
 * The KPI detail (UIUX-PLAN.md §4 S-21, METHOD.md §6, P3-T14).
 *
 * Header, the period chart with its corridor bands, the KPI's place in the
 * tree, the records table and, for a calculated KPI, the formula builder
 * P3-T13 left outstanding.
 *
 * The chart is inline SVG rather than a charting dependency. It draws one
 * series against two horizontal bands, which is a rectangle and a polyline; a
 * runtime dependency for that would be a dependency to ask the human about
 * for no gain.
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

/** Every `k` in a stored formula tree, in first-seen order. */
function referencesOf(formula: unknown): string[] {
  const out: string[] = [];
  const stack: unknown[] = [formula];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") {
      continue;
    }
    const entry = node as Record<string, unknown>;
    if (typeof entry.k === "string") {
      if (!out.includes(entry.k)) {
        out.push(entry.k);
      }
      continue;
    }
    if (entry.l) {
      stack.push(entry.r, entry.l);
    }
    if (entry.neg) {
      stack.push(entry.neg);
    }
  }
  return out;
}

export default async function KpiDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;
  const detail = await callAction(context, "kpis.detail", {
    kpiId: id,
    periods: 24,
  });
  const settings = await callAction(
    context,
    "settings.readWorkspaceSettings",
    {},
  );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(settings.settings.timezone ?? "UTC"),
  }).format(new Date());

  const { kpi } = detail;
  // Oldest first for the chart; the read returns newest first for the table.
  const series = [...detail.records].reverse();
  const target = kpi.targetDefault ?? 0;
  const values = series
    .map((record) => record.actualValue)
    .filter((value): value is number => value !== null);
  const ceiling = Math.max(target, ...values, 1) * 1.1;
  const width = 640;
  const height = 140;
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const y = (value: number) => height - (value / ceiling) * height;
  const line = series
    .map((record, index) =>
      record.actualValue === null
        ? null
        : `${index * step},${y(record.actualValue)}`,
    )
    .filter((point): point is string => point !== null)
    .join(" ");

  return (
    <AppShellLayout>
      <div className="flex w-full flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold text-ink">
                  {kpi.title}
                </h1>
                <Chip tone={stateTone(kpi.state)} dot>
                  {kpi.state}
                </Chip>
              </div>
              <p className="text-xs text-ink-3">
                {[
                  kpi.categoryName ?? "Uncategorised",
                  kpi.treeName ?? "no tree",
                  kpi.ownerName ?? "workspace owned",
                  kpi.frequency,
                  `${kpi.indicatorType} · ${kpi.tier}`,
                ].join(" · ")}
              </p>
            </div>
            <div className="flex flex-none flex-col items-end">
              <span className="text-lg font-bold text-ink tabular-nums">
                {kpi.achievementPct === null
                  ? "no data"
                  : `${Math.round(kpi.achievementPct)}%`}
              </span>
              <span className="text-xs text-ink-4">
                healthy at {Math.round(kpi.healthyPct)}%, watch at{" "}
                {Math.round(kpi.watchPct)}%
              </span>
            </div>
          </CardHeader>
          {kpi.recoveryGoalId ? (
            <CardBody className="flex flex-wrap items-center gap-2">
              <Link
                href={`/goals/${kpi.recoveryGoalId}`}
                className="text-xs font-semibold text-brand-text hover:underline"
              >
                Recovery objective
              </Link>
              <span className="text-xs text-ink-3">
                launched at{" "}
                {kpi.recoveryStartedPct === null
                  ? "an unknown point"
                  : `${Math.round(kpi.recoveryStartedPct)}%`}
                {kpi.effectivePct === null || kpi.achievementPct === null
                  ? ""
                  : `, displayed health ${Math.round(kpi.effectivePct)}% against a real ${Math.round(kpi.achievementPct)}%`}
              </span>
            </CardBody>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              The periods, against the corridor
            </h2>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            {series.length === 0 ? (
              <p className="text-sm text-ink-3">
                No periods recorded yet. The grid is where values are typed.
              </p>
            ) : (
              <svg
                viewBox={`0 0 ${width} ${height}`}
                className="h-36 w-full min-w-[32rem]"
                role="img"
                aria-label={`${kpi.title} over ${series.length} periods, with the healthy and watch bands`}
              >
                <title>{`${kpi.title} over ${series.length} periods`}</title>
                {/* The two bands, drawn from the target rather than from the
                    achievement, because a reader compares the value they typed
                    against the value they aimed at. */}
                {target > 0 ? (
                  <>
                    <rect
                      x="0"
                      y={y(ceiling)}
                      width={width}
                      height={Math.max(0, y((target * kpi.healthyPct) / 100))}
                      className="fill-ok-bg"
                    />
                    <rect
                      x="0"
                      y={y((target * kpi.healthyPct) / 100)}
                      width={width}
                      height={Math.max(
                        0,
                        y((target * kpi.watchPct) / 100) -
                          y((target * kpi.healthyPct) / 100),
                      )}
                      className="fill-warn-bg"
                    />
                    <line
                      x1="0"
                      x2={width}
                      y1={y(target)}
                      y2={y(target)}
                      className="stroke-line"
                      strokeDasharray="4 4"
                    />
                  </>
                ) : null}
                {line === "" ? null : (
                  <polyline
                    points={line}
                    fill="none"
                    className="stroke-brand-strong"
                    strokeWidth="2"
                  />
                )}
              </svg>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start">
          <Card className="flex-1">
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Records</h2>
            </CardHeader>
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Every recorded period, newest first
                </caption>
                <thead>
                  <tr className="border-line border-b text-xs text-ink-3">
                    <th className="px-3 py-1.5 text-left font-semibold">
                      Period
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold">
                      Actual
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold">
                      Target
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detail.records.length === 0 ? (
                    <tr>
                      <td className="px-3 py-2 text-ink-3" colSpan={3}>
                        Nothing recorded yet.
                      </td>
                    </tr>
                  ) : null}
                  {detail.records.map((record) => (
                    <tr
                      key={record.periodStart}
                      className="border-line border-b last:border-b-0"
                    >
                      <td className="px-3 py-1.5 text-ink-2">
                        {record.periodStart}
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink tabular-nums">
                        {record.actualValue ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink-3 tabular-nums">
                        {record.targetValue ?? kpi.targetDefault ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="p-3 text-xs text-ink-4">
                Values are typed in the grid, which is where the keyboard entry
                lives. This table reads them.
              </p>
            </CardBody>
          </Card>

          <Card className="w-full lg:w-80">
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">In the tree</h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              <div>
                <p className="text-xs font-semibold text-ink-3">Drives</p>
                {detail.parent ? (
                  <Link
                    href={`/kpis/${detail.parent.id}`}
                    className="text-sm text-brand-text hover:underline"
                  >
                    {detail.parent.title}
                  </Link>
                ) : (
                  <p className="text-sm text-ink-3">
                    Nothing. This is a root, or it has not been placed yet.
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-ink-3">Driven by</p>
                {detail.children.length === 0 ? (
                  <p className="text-sm text-ink-3">
                    No drivers. A KPI with no leading driver under it has
                    nothing a team can act on this week.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {detail.children.map((child) => (
                      <li
                        key={child.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <Link
                          href={`/kpis/${child.id}`}
                          className="min-w-0 flex-1 truncate text-sm text-brand-text hover:underline"
                        >
                          {child.title}
                        </Link>
                        <span className="text-xs text-ink-4">
                          {child.indicatorType}
                        </span>
                        <Chip tone={stateTone(child.state)} dot>
                          {child.achievementPct === null
                            ? "no data"
                            : `${Math.round(child.achievementPct)}%`}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {detail.linkedKeyResults.length > 0 ? (
                <div>
                  <p className="text-xs font-semibold text-ink-3">
                    Measures these key results
                  </p>
                  <ul className="flex flex-col gap-1">
                    {detail.linkedKeyResults.map((keyResult) => (
                      <li key={keyResult.id}>
                        <Link
                          href={`/goals/${keyResult.goalId}`}
                          className="text-sm text-brand-text hover:underline"
                        >
                          {keyResult.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Bar value={kpi.achievementPct ?? 0} />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Formula</h2>
          </CardHeader>
          <CardBody>
            {canEdit ? (
              <FormulaBuilder
                kpiId={kpi.id}
                candidates={detail.candidates}
                today={today}
                current={referencesOf(kpi.formula)}
              />
            ) : (
              <p className="text-sm text-ink-3">
                {kpi.isCalculated
                  ? "This KPI is calculated from other measures."
                  : "This KPI is entered by hand."}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
