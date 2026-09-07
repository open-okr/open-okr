import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/auth";
import { KPI_TABS, SectionTabs } from "../../../lib/section-tabs.tsx";
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

const percent = (value: number | null) =>
  value === null ? "no data" : `${Math.round(value)}%`;

export default async function RecoveryBoardPage() {
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
    <AppShellLayout>
      <div className="flex w-full flex-col gap-3.5">
        <SectionTabs items={KPI_TABS} active="/kpis/recovery" />
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Recovery board</h1>
              <p className="text-xs text-ink-3">
                {board.cards.length === 0
                  ? "All KPIs healthy."
                  : `${board.cards.length} measure${
                      board.cards.length === 1 ? "" : "s"
                    } below the corridor or under recovery.`}
              </p>
            </div>
          </CardHeader>
        </Card>

        {board.cards.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-2">All KPIs healthy.</p>
              <p className="mt-1 text-xs text-ink-4">
                A KPI joins this board the moment its achievement falls below
                the watch floor, and leaves it when the real number comes back.
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
                    {card.state === "recovering" ? "recovering" : "unhealthy"}
                  </Chip>
                </div>
                <p className="text-xs text-ink-3">
                  {card.treeName ?? "No tree yet"}
                </p>
              </div>
              <div className="flex flex-none flex-col items-end">
                <span className="text-sm font-bold text-ink tabular-nums">
                  {percent(card.achievementPct)}
                </span>
                <span className="text-xs text-ink-4">
                  healthy at {Math.round(card.healthyPct)}%
                </span>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col gap-2">
              <Bar value={card.achievementPct ?? 0} />

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
                  <Bar value={card.recovery.progressPct} />
                  <p className="text-xs text-ink-3">
                    {card.recovery.keyResults} key result
                    {card.recovery.keyResults === 1 ? "" : "s"}
                    {card.recovery.startedPct === null
                      ? ""
                      : `, launched at ${Math.round(card.recovery.startedPct)}%`}
                    {card.effectivePct === null ||
                    card.achievementPct === null ||
                    card.effectivePct <= card.achievementPct
                      ? ""
                      : `. Displayed health ${percent(card.effectivePct)}, real ${percent(card.achievementPct)}`}
                  </p>
                  {card.recovery.closeProposed && !card.recovery.closed ? (
                    <p className="text-xs font-semibold text-ok">
                      The real number is back inside the corridor. Close the
                      objective when the team agrees it is done.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-ink-3">
                    No recovery objective yet. The draft comes from the leading
                    drivers under this KPI.
                  </p>
                  {canEdit ? (
                    <LaunchRecovery kpiId={card.kpiId} />
                  ) : (
                    <span className="text-xs text-ink-4">
                      You can read this board but not launch a recovery.
                    </span>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </AppShellLayout>
  );
}
