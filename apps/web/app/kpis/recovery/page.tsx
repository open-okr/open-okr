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
import { workspaceReaderLevel } from "../../../lib/access";
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
 * A recovering KPI shows its real band and reading, with the recovery's own
 * progress beside them (§6.4, P9-T17b-a). It used to show a projected
 * "displayed health" too, which is the recovery's progress dressed as the
 * metric, and METHOD v2 says never in its place.
 */
const stateTone = (state: string) =>
  state === "unhealthy"
    ? ("bad" as const)
    : state === "watch"
      ? ("warn" as const)
      : state === "healthy"
        ? ("ok" as const)
        : ("neutral" as const);

/** The words for a card's real band. A card is unhealthy or under recovery. */
const BAND_WORD: Readonly<Record<string, string>> = {
  unhealthy: "kpis.recovery.stateUnhealthy",
  watch: "kpis.recovery.stateWatch",
  healthy: "kpis.recovery.stateHealthy",
  no_data: "kpis.recovery.stateNoData",
};

type Translate = (key: string, values?: MessageValues) => string;

const percent = (value: number | null, t: Translate) =>
  value === null ? t("kpis.recovery.noData") : `${Math.round(value)}%`;

/**
 * The line under a recovery objective: how many key results it has, and where
 * it was launched. Each variant is a whole message with holes, so no sentence
 * is assembled from English pieces.
 */
function recoverySummary(
  recovery: {
    readonly keyResults: number;
    readonly startedPct: number | null;
  },
  t: Translate,
): string {
  const keyResults =
    recovery.keyResults === 1
      ? t("common.count.keyResultOne", { count: recovery.keyResults })
      : t("common.count.keyResultOther", { count: recovery.keyResults });
  return recovery.startedPct === null
    ? keyResults
    : t("kpis.recovery.keyResultsLaunchedAt", {
        keyResults,
        startedPct: Math.round(recovery.startedPct),
      });
}

export default async function RecoveryBoardPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await workspaceReaderLevel(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;
  // After the level, because it reads a workspace setting a guest cannot
  // (L-23).
  const ceiling = await progressCeiling();
  const board = await callAction(context, "kpis.recoveryBoard", {});

  // What launching would create, read before anybody presses it
  // (completeness review M-09). METHOD.md §6.5's recovery objective is a
  // template over the driver tree and needs no provider, and `kpis.recoveryDraft`
  // exists so it can be read before it is committed to, which nothing did: the
  // button launched a write the reader had never seen. One read per card
  // without a recovery, for somebody who may launch one.
  const recoveryDrafts = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof callAction<"kpis.recoveryDraft">>>>
  >();
  if (canEdit) {
    for (const card of board.cards) {
      if (card.recovery) {
        continue;
      }
      const draft = await callAction(context, "kpis.recoveryDraft", {
        kpiId: card.kpiId,
      });
      if (draft) {
        recoveryDrafts.set(card.kpiId, draft);
      }
    }
  }

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
                  {t(BAND_WORD[card.state] ?? "kpis.recovery.stateUnhealthy")}
                </Chip>
                {/* Beside the band, never instead of it (§6.4, P9-T17b-a). */}
                {card.recovering ? (
                  <Chip tone="info">{t("kpis.recovery.stateRecovering")}</Chip>
                ) : null}
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
                  {recoverySummary(card.recovery, t)}
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
                {recoveryDrafts.has(card.kpiId) ? (
                  <section
                    aria-label={t("kpis.recovery.launchingCreates")}
                    className="flex w-full flex-col gap-1 rounded-md border border-line p-2.5"
                  >
                    <p className="text-xs font-semibold text-ink-3">
                      {t("kpis.recovery.launchingCreates")}
                    </p>
                    <p className="text-sm text-ink">
                      {recoveryDrafts.get(card.kpiId)?.objective}
                    </p>
                    <ul className="flex list-disc flex-col gap-0.5 pl-4">
                      {recoveryDrafts
                        .get(card.kpiId)
                        ?.keyResults.map((keyResult) => (
                          <li
                            key={keyResult.title}
                            className="text-xs text-ink-2"
                          >
                            {keyResult.title}
                          </li>
                        ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
