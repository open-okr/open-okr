import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  Bar,
  Card,
  CardBody,
  CardHeader,
  Chip,
  type MessageValues,
} from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { KPI_ACHIEVEMENT_MAX, progressCeiling } from "../../../lib/ceilings.ts";
import { KPI_TABS, SectionTabs } from "../../../lib/section-tabs.tsx";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { LaunchRecovery } from "./launch.tsx";

/**
 * The recovery board (UIUX-PLAN.md §4 S-19, METHOD.md §6.6, P3-T14).
 *
 * One list across every tree: every KPI that is unhealthy or recovering, with
 * either its recovery objective and progress or a one-click launch. METHOD.md
 * calls this the KPI equivalent of the review inbox, and the same rule applies:
 * a healthy KPI is not on it, because a board that never empties stops being
 * read.
 *
 * Both figures are shown wherever a KPI is recovering. The effective number is
 * what §6.5 asks a screen to display, and showing it alone would report the
 * recovery's own progress as if it were the metric.
 */
const stateTone = (state: string) =>
  state === "unhealthy"
    ? ("bad" as const)
    : state === "recovering"
      ? ("info" as const)
      : ("neutral" as const);

type Translate = (key: string, values?: MessageValues) => string;

const percent = (value: number | null, t: Translate) =>
  value === null ? t("kpis.recovery.noData") : `${Math.round(value)}%`;

/**
 * The line under a recovery objective: how many key results it has, where it
 * was launched and, when the displayed health is above the real number, both
 * figures. Each variant is a whole message with holes, so no sentence is
 * assembled from English pieces.
 */
function recoverySummary(
  recovery: {
    readonly keyResults: number;
    readonly startedPct: number | null;
  },
  effectivePct: number | null,
  achievementPct: number | null,
  t: Translate,
): string {
  const keyResults =
    recovery.keyResults === 1
      ? t("common.count.keyResultOne", { count: recovery.keyResults })
      : t("common.count.keyResultOther", { count: recovery.keyResults });
  const summary =
    recovery.startedPct === null
      ? keyResults
      : t("kpis.recovery.keyResultsLaunchedAt", {
          keyResults,
          startedPct: Math.round(recovery.startedPct),
        });
  if (
    effectivePct === null ||
    achievementPct === null ||
    effectivePct <= achievementPct
  ) {
    return summary;
  }
  return t("kpis.recovery.displayedHealthReal", {
    summary,
    displayed: percent(effectivePct, t),
    real: percent(achievementPct, t),
  });
}

export default async function RecoveryBoardPage() {
  const { t } = await getTranslations();
  const ceiling = await progressCeiling();

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
  const board = await callAction(context, "kpis.recoveryBoard", {});

  return (
    <div className="flex w-full flex-col gap-3.5">
      <SectionTabs items={KPI_TABS} active="/kpis/recovery" />
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">
              {t("kpis.recovery.recoveryBoard")}
            </h1>
            <p className="text-xs text-ink-3">
              {board.cards.length === 0
                ? t("kpis.recovery.allKpisHealthy")
                : board.cards.length === 1
                  ? t("kpis.recovery.measuresBelowOne", {
                      count: board.cards.length,
                    })
                  : t("kpis.recovery.measuresBelowOther", {
                      count: board.cards.length,
                    })}
            </p>
          </div>
        </CardHeader>
      </Card>

      {board.cards.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("kpis.recovery.allKpisHealthy")}
            </p>
            <p className="mt-1 text-xs text-ink-4">
              {t("kpis.recovery.aKpiJoinsThis")}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {board.cards.map((card) => (
        <Card key={card.kpiId}>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-bold text-ink">
                  {card.title}
                </h2>
                <Chip tone={stateTone(card.state)} dot>
                  {card.state === "recovering"
                    ? t("kpis.recovery.stateRecovering")
                    : t("kpis.recovery.stateUnhealthy")}
                </Chip>
              </div>
              <p className="text-xs text-ink-3">
                {card.treeName ?? t("kpis.recovery.noTreeYet")}
              </p>
            </div>
            <div className="flex flex-none flex-col items-end">
              <span className="text-sm font-bold text-ink tabular-nums">
                {percent(card.achievementPct, t)}
              </span>
              <span className="text-xs text-ink-4">
                {t("common.healthyAt", {
                  healthyPct: Math.round(card.healthyPct),
                })}
              </span>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {/* §6.4 measures achievement 0 to 200, and this drew it on a
                0-to-100 track, so a KPI at 180 and one at exactly 100 filled
                the same bar (P8-G04). */}
            <Bar value={card.achievementPct ?? 0} max={KPI_ACHIEVEMENT_MAX} />

            {card.recovery ? (
              <div className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/goals/${card.recovery.goalId}`}
                    className="truncate text-sm font-semibold text-brand-text hover:underline"
                  >
                    {card.recovery.title}
                  </Link>
                  <span className="flex-none text-xs text-ink-3 tabular-nums">
                    {Math.round(card.recovery.progressPct)}%
                  </span>
                </div>
                <Bar value={card.recovery.progressPct} max={ceiling} />
                <p className="text-xs text-ink-3">
                  {recoverySummary(
                    card.recovery,
                    card.effectivePct,
                    card.achievementPct,
                    t,
                  )}
                </p>
                {card.recovery.closeProposed && !card.recovery.closed ? (
                  <p className="text-xs font-semibold text-ok">
                    {t("kpis.recovery.theRealNumberIs")}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-3">
                  {t("kpis.recovery.noRecoveryObjectiveYet")}
                </p>
                {canEdit ? (
                  <LaunchRecovery kpiId={card.kpiId} />
                ) : (
                  <span className="text-xs text-ink-4">
                    {t("kpis.recovery.youCanReadThis")}
                  </span>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
