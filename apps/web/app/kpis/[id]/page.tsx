import {
  ACCESS_LEVELS,
  callAction,
  OperationError,
  RHYTHM_ASSIST_KEYS,
} from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { assistOffered } from "../../../lib/assists";
import { getPool } from "../../../lib/auth";
import { KPI_ACHIEVEMENT_MAX } from "../../../lib/ceilings.ts";
import { getTranslations } from "../../../lib/translations";
import { WatchControl } from "../../../lib/watch-control.tsx";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import { updateKpiRule } from "../actions.ts";
import { JudgedBy } from "../judged-by.tsx";
import { FormulaBuilder } from "./formula-builder.tsx";
import { TrendNarration } from "./trend-narration.tsx";

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
  const { t } = await getTranslations();

  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  // Whether this reader is watching this subject (P6-G07b). Read here rather
  // than in the control, because the control is a client component and the
  // answer is part of the page's own first paint.
  const watch = await callAction(context, "subscriptions.read", {
    subjectType: "kpi",
    subjectId: id,
  });

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  // A KPI somebody may not see is indistinguishable from one that does not
  // exist (§8.1 layer 2), and both are a 404 rather than the root error
  // boundary. Until the gap audit of 7 September 2026 this was the only detail
  // route without the guard, so a mistyped id read "something went wrong".
  let detail: Awaited<ReturnType<typeof callAction<"kpis.detail">>>;
  try {
    detail = await callAction(context, "kpis.detail", {
      kpiId: id,
      periods: 24,
    });
  } catch (error) {
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }
  const settings = await callAction(context, "settings.readForMember", {});
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(settings.settings.timezone ?? "UTC"),
  }).format(new Date());

  const { kpi } = detail;
  // Who may own it: a person who is here (§6.2, P9-T17b-b). Read only for
  // somebody who may change it.
  const people = canEdit
    ? (await callAction(context, "people.directory", {})).filter(
        (member) => member.kind === "human" && member.status === "active",
      )
    : [];
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

  // §2.2's narration beside the chart (M-09). Offered only for a series with
  // two measured points, because one point is not a trend, and only where a
  // provider may write it; with AI off the chart is the whole card.
  const narrationOffered =
    values.length >= 2 &&
    (await assistOffered(
      workspace.workspaceId,
      RHYTHM_ASSIST_KEYS.narrateTrend,
      "balanced",
      session.user.id,
    ));

  return (
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
              {/* Beside the band, never instead of it (§6.4, P9-T17b-a). */}
              {kpi.recovering ? (
                <Chip tone="info">{t("kpis.grid.recovering")}</Chip>
              ) : null}
            </div>
            <p className="text-xs text-ink-3">
              {[
                kpi.categoryName ?? t("kpis.detail.uncategorised"),
                kpi.treeName ?? t("kpis.detail.noTree"),
                kpi.ownerName ?? t("kpis.detail.workspaceOwned"),
                kpi.frequency,
                kpi.tier
                  ? `${kpi.indicatorType} · ${kpi.tier}`
                  : kpi.indicatorType,
              ].join(" · ")}
            </p>
          </div>
          <div className="flex flex-none flex-col items-end">
            <span className="text-lg font-bold text-ink tabular-nums">
              {kpi.achievementPct === null
                ? t("kpis.detail.noData")
                : `${Math.round(kpi.achievementPct)}%`}
            </span>
            <span className="text-xs text-ink-4">
              {t("common.healthyAtWatchAt", {
                healthyPct: Math.round(kpi.healthyPct),
                watchPct: Math.round(kpi.watchPct),
              })}
            </span>
          </div>
          <WatchControl subjectType="kpi" subjectId={id} initial={watch} />
        </CardHeader>
        {kpi.recoveryGoalId ? (
          <CardBody className="flex flex-wrap items-center gap-2">
            <Link
              href={`/goals/${kpi.recoveryGoalId}`}
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              {t("kpis.detail.recoveryObjective")}
            </Link>
            {/* The recovery's own progress beside the KPI's real reading,
                never a projection in its place (§6.4, NW-Q3-05). */}
            <span className="text-xs text-ink-3">
              {kpi.recoveryStartedPct === null
                ? t("kpis.detail.launchedAtAnUnknownPointProgress", {
                    progress: Math.round(kpi.recoveryProgressPct ?? 0),
                  })
                : t("kpis.detail.launchedAtPctProgress", {
                    recoveryStartedPct: Math.round(kpi.recoveryStartedPct),
                    progress: Math.round(kpi.recoveryProgressPct ?? 0),
                  })}
            </span>
          </CardBody>
        ) : null}
      </Card>

      {/* How it is judged, who owns it and its tier (§6.2, §6.4,
          P9-T17b-b). */}
      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">
            {t("kpis.rule.howItIsJudged")}
          </h2>
          <span data-testid="kpi-basis" className="text-xs text-ink-3">
            {kpi.basis === "thresholds"
              ? t("kpis.rule.byThresholds")
              : t("kpis.rule.byRatio")}
            {" · "}
            {kpi.namedOwnerName
              ? t("kpis.rule.ownedBy", { name: kpi.namedOwnerName })
              : t("kpis.rule.nobodyNamed")}
          </span>
        </CardHeader>
        {canEdit ? (
          <CardBody>
            <ActionForm action={updateKpiRule} className="flex flex-col gap-2">
              <input type="hidden" name="kpiId" value={kpi.id} />
              <JudgedBy
                idPrefix="edit"
                initial={{
                  targetType: kpi.targetType,
                  greenLow: kpi.greenLow,
                  greenHigh: kpi.greenHigh,
                  redLow: kpi.redLow,
                  redHigh: kpi.redHigh,
                }}
              />
              <div className="flex flex-wrap items-center gap-2.5">
                <label
                  className="text-xs text-ink-3"
                  htmlFor="edit-ownerMemberId"
                >
                  {t("kpis.rule.owner")}
                </label>
                <select
                  id="edit-ownerMemberId"
                  name="ownerMemberId"
                  defaultValue={kpi.namedOwnerId ?? ""}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                >
                  <option value="">{t("kpis.rule.nobodyNamedOption")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <label className="text-xs text-ink-3" htmlFor="edit-tier">
                  {t("kpis.rule.tier")}
                </label>
                <select
                  id="edit-tier"
                  name="tier"
                  defaultValue={kpi.tier ?? ""}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2"
                >
                  <option value="">{t("kpis.rule.noTier")}</option>
                  <option value="input">{t("kpis.rule.tierInput")}</option>
                  <option value="output">{t("kpis.rule.tierOutput")}</option>
                  <option value="outcome">{t("kpis.rule.tierOutcome")}</option>
                  <option value="impact">{t("kpis.rule.tierImpact")}</option>
                </select>
              </div>
              <button
                type="submit"
                className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
              >
                {t("common.save")}
              </button>
            </ActionForm>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("kpis.detail.thePeriodsAgainstThe")}
          </h2>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {series.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("kpis.detail.noPeriodsRecordedYet")}
            </p>
          ) : (
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="h-36 w-full min-w-[32rem]"
              role="img"
              aria-label={
                series.length === 1
                  ? t("kpis.detail.chartLabelOne", {
                      title: kpi.title,
                      count: series.length,
                    })
                  : t("kpis.detail.chartLabelOther", {
                      title: kpi.title,
                      count: series.length,
                    })
              }
            >
              <title>
                {series.length === 1
                  ? t("kpis.detail.chartTitleOne", {
                      title: kpi.title,
                      count: series.length,
                    })
                  : t("kpis.detail.chartTitleOther", {
                      title: kpi.title,
                      count: series.length,
                    })}
              </title>
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
          {narrationOffered ? (
            <div className="mt-3">
              <TrendNarration kpiId={kpi.id} />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start">
        <Card className="flex-1">
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("kpis.detail.records")}
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {t("kpis.detail.everyRecordedPeriodNewest")}
              </caption>
              <thead>
                <tr className="border-line border-b text-xs text-ink-3">
                  <th className="px-3 py-1.5 text-left font-semibold">
                    {t("common.period")}
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold">
                    {t("kpis.detail.actual")}
                  </th>
                  <th className="px-3 py-1.5 text-right font-semibold">
                    {t("common.target")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.records.length === 0 ? (
                  <tr>
                    <td className="px-3 py-2 text-ink-3" colSpan={3}>
                      {t("kpis.detail.nothingRecordedYet")}
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
              {t("kpis.detail.valuesAreTypedIn")}
            </p>
          </CardBody>
        </Card>

        <Card className="w-full lg:w-80">
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("kpis.detail.inTheTree")}
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            <div>
              <p className="text-xs font-semibold text-ink-3">
                {t("kpis.detail.drives")}
              </p>
              {detail.parent ? (
                <Link
                  href={`/kpis/${detail.parent.id}`}
                  className="text-sm text-brand-text hover:underline"
                >
                  {detail.parent.title}
                </Link>
              ) : (
                <p className="text-sm text-ink-3">
                  {t("kpis.detail.nothingThisIsA")}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-3">
                {t("kpis.detail.drivenBy")}
              </p>
              {detail.children.length === 0 ? (
                <p className="text-sm text-ink-3">
                  {t("kpis.detail.noDriversAKpi")}
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
                          ? t("kpis.detail.noData")
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
                  {t("kpis.detail.measuresTheseKeyResults")}
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
            <Bar value={kpi.achievementPct ?? 0} max={KPI_ACHIEVEMENT_MAX} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("kpis.detail.formula")}
          </h2>
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
                ? t("kpis.detail.thisKpiIsCalculated")
                : t("kpis.detail.thisKpiIsEnteredByHand")}
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
