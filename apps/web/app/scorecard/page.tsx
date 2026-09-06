import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../lib/access";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { verdictLabel, verdictTone } from "../../lib/verdict";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { handOver, recordPerformance } from "./actions.ts";

/**
 * The scorecard (METHOD.md §8.9, TECHNICAL-PLAN §4.6, P3-T15).
 *
 * One row per archived cycle, oldest first, so the trend reads left to right
 * the way time does. The band table and the verdict come from the snapshot
 * rather than being recomputed here: a scorecard that recalculated would drift
 * from the number the review actually agreed on.
 *
 * The workspace scope only. A space or a member reads their own trend from
 * their own page, because a table that mixed the three would add numbers that
 * answer different questions.
 */
export default async function ScorecardPage() {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const scorecard = await callAction(context, "cycles.scorecard", {});
  const cycles = await callAction(context, "cycles.list", {});
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  // The trend, as a sparkline over the results that exist. Cycles with no
  // result are skipped rather than drawn at zero: a cycle nobody scored is not
  // a cycle that scored nothing.
  const points = scorecard.rows
    .map((row, index) => ({ index, value: row.resultValue }))
    .filter(
      (point): point is { index: number; value: number } =>
        point.value !== null,
    );
  const trendWidth = 240;
  const trendHeight = 40;
  const trendStep =
    scorecard.rows.length > 1 ? trendWidth / (scorecard.rows.length - 1) : 0;
  const trend = points
    .map(
      (point) =>
        `${point.index * trendStep},${trendHeight - point.value * trendHeight}`,
    )
    .join(" ");

  // The export is a data URL rather than a route, so it needs no endpoint and
  // no second read that could disagree with the table above it.
  const csv = [
    "cycle,starts_on,result,verdict,fully_achieved,strong,partial,little",
    ...scorecard.rows.map((row) =>
      [
        `"${row.cycleName.replace(/"/g, '""')}"`,
        row.startsOn,
        row.resultValue ?? "",
        row.verdict ?? "",
        row.fullyAchieved,
        row.strong,
        row.partial,
        row.little,
      ].join(","),
    ),
  ].join("\n");

  return (
    <AppShellLayout>
      <div className="flex w-full flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Scorecard</h1>
              <p className="text-xs text-ink-3">
                {scorecard.rows.length === 0
                  ? "No cycle has been archived yet."
                  : `${scorecard.rows.length} archived cycle${
                      scorecard.rows.length === 1 ? "" : "s"
                    }, oldest first.`}
              </p>
            </div>
            {scorecard.rows.length > 0 ? (
              <a
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
                download="scorecard.csv"
                className="text-xs font-semibold text-brand-text hover:underline"
              >
                Export as CSV
              </a>
            ) : null}
          </CardHeader>
          {points.length > 1 ? (
            <CardBody className="pb-0">
              <svg
                viewBox={`0 0 ${trendWidth} ${trendHeight}`}
                className="h-10 w-full max-w-sm"
                role="img"
                aria-label={`The result across ${points.length} scored cycles, from ${points[0]?.value.toFixed(2)} to ${points[points.length - 1]?.value.toFixed(2)}`}
              >
                <title>Result across cycles</title>
                <polyline
                  points={trend}
                  fill="none"
                  className="stroke-brand-strong"
                  strokeWidth="2"
                />
              </svg>
            </CardBody>
          ) : null}
          <CardBody className="p-0">
            {scorecard.rows.length === 0 ? (
              <p className="p-3 text-sm text-ink-3">
                A cycle joins this table when it is archived at the close of its
                review. Nothing is written before then, because a score is a
                judgement somebody makes rather than a number the product
                computes.
              </p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Every archived cycle with its result, verdict and band counts
                </caption>
                <thead>
                  <tr className="border-line border-b text-xs text-ink-3">
                    <th className="px-3 py-1.5 text-left font-semibold">
                      Cycle
                    </th>
                    <th className="px-3 py-1.5 text-left font-semibold">
                      Result
                    </th>
                    <th className="px-3 py-1.5 text-left font-semibold">
                      Verdict
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold">
                      1.0
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold">
                      strong
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold">
                      partial
                    </th>
                    <th className="px-3 py-1.5 text-right font-semibold">
                      little
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scorecard.rows.map((row) => (
                    <tr
                      key={row.cycleId}
                      className="border-line border-b last:border-b-0"
                    >
                      <td className="px-3 py-2">
                        <span className="text-ink">{row.cycleName}</span>
                        <span className="ml-1.5 text-xs text-ink-4">
                          {row.startsOn}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-10 text-ink tabular-nums">
                            {row.resultValue === null
                              ? "—"
                              : row.resultValue.toFixed(2)}
                          </span>
                          <Bar
                            value={(row.resultValue ?? 0) * 100}
                            className="w-20"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Chip tone={verdictTone(row.verdict)} dot>
                          {verdictLabel(row.verdict)}
                        </Chip>
                      </td>
                      <td className="px-3 py-2 text-right text-ink-2 tabular-nums">
                        {row.fullyAchieved}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-2 tabular-nums">
                        {row.strong}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-2 tabular-nums">
                        {row.partial}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-2 tabular-nums">
                        {row.little}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        {canEdit ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Close a cycle out</h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              <ActionForm
                action={recordPerformance}
                className="flex flex-wrap items-center gap-2"
              >
                <label className="text-xs text-ink-3" htmlFor="cycleId">
                  Record the result of
                </label>
                <select
                  id="cycleId"
                  name="cycleId"
                  required
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                >
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  Record
                </button>
              </ActionForm>

              <ActionForm
                action={handOver}
                className="flex flex-wrap items-center gap-2"
              >
                <label className="text-xs text-ink-3" htmlFor="fromCycleId">
                  Hand over from
                </label>
                <select
                  id="fromCycleId"
                  name="fromCycleId"
                  required
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                >
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name}
                    </option>
                  ))}
                </select>
                <label className="text-xs text-ink-3" htmlFor="toCycleId">
                  into
                </label>
                <select
                  id="toCycleId"
                  name="toCycleId"
                  required
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                >
                  {cycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>
                      {cycle.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  Hand over
                </button>
              </ActionForm>

              <p className="text-xs text-ink-4">
                Both belong to the quarterly review's own close, which exists
                now, and to cycle phase 7, which arrives at P6-G16. They stay
                here as well, because an action nobody can reach is an action
                nobody can check. Running either twice changes nothing.
              </p>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Points</h2>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-ink-3">
              {scorecard.pointsEnabled
                ? "The points layer is on for this workspace."
                : "The points layer is off, and no points exist. It stays off until somebody turns it on."}
            </p>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
