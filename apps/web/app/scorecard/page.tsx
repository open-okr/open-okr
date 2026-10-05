import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { workspaceReaderLevel } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { CYCLE_TABS, SectionTabs } from "../../lib/section-tabs.tsx";
import { getTranslations } from "../../lib/translations";
import { verdictLabel, verdictTone } from "../../lib/verdict";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { closeCycle } from "../cycle/frame-actions.ts";

/** A result coloured by its own cycle's bands (METHOD.md §3.3, §12). */
const BAND_TONE = {
  fully_achieved: "ok",
  strong: "ok",
  partial: "warn",
  little: "bad",
} as const;

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
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  // Before the first read, so a guest is moved rather than refused (L-23).
  const level = await workspaceReaderLevel(
    workspace.workspaceId,
    workspace.memberId,
  );
  const scorecard = await callAction(context, "cycles.scorecard", {});
  const cycles = await callAction(context, "cycles.list", {});
  // `full`, which is what `cycles.close` requires. A control that will be
  // refused for everybody below it is a control nobody below it should see.
  const canClose = level >= ACCESS_LEVELS.full;
  // The cycles still open, oldest first: the one most likely to be waiting on
  // its close is the oldest one nobody has closed. `cycles.list` is newest
  // first.
  const closable = cycles
    .filter((cycle) => cycle.status !== "closed")
    .reverse();

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
    <div className="flex w-full flex-col gap-3.5">
      <SectionTabs items={CYCLE_TABS} active="/scorecard" />
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">
              {t("scorecard.scorecard")}
            </h1>
            <p className="text-xs text-ink-3">
              {scorecard.rows.length === 0
                ? t("scorecard.noCycleHasBeen")
                : scorecard.rows.length === 1
                  ? t("scorecard.archivedCyclesOne", {
                      count: scorecard.rows.length,
                    })
                  : t("scorecard.archivedCyclesOther", {
                      count: scorecard.rows.length,
                    })}
            </p>
          </div>
          {scorecard.rows.length > 0 ? (
            <a
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}
              download="scorecard.csv"
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              {t("scorecard.exportAsCsv")}
            </a>
          ) : null}
        </CardHeader>
        {points.length > 1 ? (
          <CardBody className="pb-0">
            <svg
              viewBox={`0 0 ${trendWidth} ${trendHeight}`}
              className="h-10 w-full max-w-sm"
              role="img"
              aria-label={t("scorecard.resultAcrossScoredCycles", {
                count: points.length,
                from: points[0]?.value.toFixed(2) ?? "",
                to: points[points.length - 1]?.value.toFixed(2) ?? "",
              })}
            >
              <title>{t("scorecard.resultAcrossCycles")}</title>
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
              {t("scorecard.aCycleJoinsThis")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">
                {t("scorecard.everyArchivedCycleWith")}
              </caption>
              <thead>
                <tr className="border-line border-b text-xs text-ink-3">
                  <th className="px-3 py-1.5 text-left font-semibold">
                    {t("scorecard.cycle")}
                  </th>
                  <th className="px-3 py-1.5 text-left font-semibold">
                    {t("scorecard.result")}
                  </th>
                  <th className="px-3 py-1.5 text-left font-semibold">
                    {t("scorecard.verdict")}
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold">1.0</th>
                  <th className="px-3 py-1.5 text-right font-semibold">
                    {t("scorecard.strong")}
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold">
                    {t("scorecard.partial")}
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold">
                    {t("scorecard.little")}
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
                      {/* §12 (P9-T14c): the bands this cycle was graded
                       * under, which a band moved since does not change. */}
                      <span
                        className="block text-xs text-ink-4"
                        data-testid="scorecard-bands"
                      >
                        {t("scorecard.gradedOn", {
                          strong: row.bands.strong.toFixed(1),
                          partial: row.bands.partial.toFixed(1),
                        })}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {row.resultValue === null ? (
                          <span className="w-10 text-ink tabular-nums">—</span>
                        ) : (
                          // Coloured by its own cycle's bands (§12).
                          <Chip
                            tone={BAND_TONE[row.resultBand ?? "little"]}
                            data-testid="scorecard-result"
                            data-band={row.resultBand ?? undefined}
                          >
                            {row.resultValue.toFixed(2)}
                          </Chip>
                        )}
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

      {/* What moved in each cycle, so the close can see behind its number
       * (METHOD.md §3.3, §2.9, §2.8, P9-T14c). Only a cycle where something
       * moved is listed. */}
      {scorecard.rows.some(
        (row) =>
          row.moved.adjusted.length > 0 ||
          row.moved.eased.length > 0 ||
          row.moved.addedMidCycle > 0 ||
          row.moved.kindChanges.length > 0,
      ) ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("scorecard.whatMoved")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {scorecard.rows
              .filter(
                (row) =>
                  row.moved.adjusted.length > 0 ||
                  row.moved.eased.length > 0 ||
                  row.moved.addedMidCycle > 0 ||
                  row.moved.kindChanges.length > 0,
              )
              .map((row) => (
                <section
                  key={row.cycleId}
                  className="flex flex-col gap-1"
                  data-testid="scorecard-moved"
                  aria-label={row.cycleName}
                >
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3">
                    {row.cycleName}
                  </h3>
                  <ul className="flex flex-col gap-1 text-sm text-ink-2">
                    {row.moved.adjusted.map((entry) => (
                      <li key={`a-${entry.keyResultId}`}>
                        {t("scorecard.adjustedLine", {
                          title: entry.title,
                          score: entry.score.toFixed(2),
                          computed: entry.computed.toFixed(2),
                          reason: entry.reason,
                        })}
                      </li>
                    ))}
                    {row.moved.eased.map((entry) => (
                      <li key={`e-${entry.keyResultId}`}>
                        {entry.reason
                          ? t("scorecard.easedLineBecause", {
                              title: entry.title,
                              original: String(entry.original),
                              target:
                                entry.target === null
                                  ? "-"
                                  : String(entry.target),
                              reason: entry.reason,
                            })
                          : t("scorecard.easedLine", {
                              title: entry.title,
                              original: String(entry.original),
                              target:
                                entry.target === null
                                  ? "-"
                                  : String(entry.target),
                            })}
                      </li>
                    ))}
                    {row.moved.addedMidCycle > 0 ? (
                      <li>
                        {t("scorecard.addedMidCycle", {
                          count: row.moved.addedMidCycle,
                        })}
                      </li>
                    ) : null}
                    {row.moved.kindChanges.map((entry) => (
                      <li key={`k-${entry.goalId}-${entry.at}`}>
                        {entry.reason
                          ? t("scorecard.kindLineBecause", {
                              title: entry.title,
                              from: entry.from,
                              to: entry.to,
                              reason: entry.reason,
                            })
                          : t("scorecard.kindLine", {
                              title: entry.title,
                              from: entry.from,
                              to: entry.to,
                            })}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </CardBody>
        </Card>
      ) : null}

      {/*
       * **One control, where two buttons were** (M-05). Recording the result
       * and handing over to the next cycle were separate forms here, and
       * nothing set a cycle to closed. Closing now does both, as METHOD.md
       * §8.9 says the close does. It stays on this screen as well as on phase
       * 7 because the cycle screen shows the current cycle, and the one
       * waiting to close has usually just stopped being current.
       */}
      {canClose && closable.length > 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("scorecard.closeACycleOut")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <ActionForm
              action={closeCycle}
              className="flex flex-wrap items-center gap-2"
            >
              <label className="text-xs text-ink-3" htmlFor="cycleId">
                {t("scorecard.cycleToClose")}
              </label>
              <select
                id="cycleId"
                name="cycleId"
                required
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
              >
                {closable.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
              >
                {t("scorecard.close")}
              </button>
            </ActionForm>

            <p className="text-xs text-ink-4">
              {t("scorecard.closingRecordsAndFeeds")}
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("scorecard.points")}
          </h2>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-ink-3">
            {scorecard.pointsEnabled
              ? t("scorecard.thePointsLayerIsOn")
              : t("scorecard.thePointsLayerIsOff")}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
