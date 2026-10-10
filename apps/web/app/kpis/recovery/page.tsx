import { ACCESS_LEVELS, callAction } from "@openokr/core";
import {
  Bar,
  Card,
  CardBody,
  CardHeader,
  Chip,
  DateInput,
  type MessageValues,
  NumberInput,
} from "@openokr/ui";
import Link from "next/link";
import { workspaceReaderLevel } from "../../../lib/access";
import { getPool } from "../../../lib/auth";
import { KPI_ACHIEVEMENT_MAX, progressCeiling } from "../../../lib/ceilings.ts";
import { KPI_TABS, SectionTabs } from "../../../lib/section-tabs.tsx";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ActionForm } from "../../cycle/action-form.tsx";
import {
  answerKpiWithKeyResult,
  fixKpiNow,
  nameKpiKeyResult,
} from "./actions.ts";
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
 * An unhealthy KPI nobody has answered asks for a decision, and offers §6.5's
 * three: fix it now as a task with an owner and a date, add a key result for
 * it to an objective that exists, or launch a recovery OKR (P9-T18b). One
 * that has been answered shows the answer instead, until the task is done or
 * the objective closes.
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

const FIELD =
  "rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink";

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

  // What the other two responses need, read only when somebody may give one
  // and a card is waiting for it (§6.5, P9-T18b): who could own a fix and
  // where it could live, and the objectives a key result could join.
  const waiting = canEdit
    ? board.cards.filter((card) => !card.recovery && !card.response?.open)
    : [];
  const people =
    waiting.length === 0
      ? []
      : (await callAction(context, "people.directory", {})).filter(
          (member) => member.kind === "human" && member.status === "active",
        );
  const spaces =
    waiting.length === 0 ? [] : await callAction(context, "spaces.list", {});
  const cycle =
    waiting.length === 0
      ? null
      : await callAction(context, "cycles.current", { mode: "quarterly" });
  const objectives = cycle
    ? (
        await callAction(context, "goals.list", {
          cycleId: cycle.id,
          includeClosed: false,
        })
      ).goals
    : [];

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
        // The anchor a proposed recovery in the review inbox links to, so the
        // other two responses are one click from it (§6.5, P9-T18b).
        <Card key={card.kpiId} id={`kpi-${card.kpiId}`}>
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
            ) : card.response?.open ? (
              <div
                data-testid="kpi-response"
                className="flex flex-col gap-1 rounded-md border border-line p-2.5"
              >
                <p className="text-xs font-semibold text-ink-3">
                  {card.response.kind === "fix_now"
                    ? t("kpis.recovery.respond.beingFixed")
                    : t("kpis.recovery.respond.answeredByKeyResult")}
                </p>
                {card.response.subjectId === null ? (
                  <p className="text-xs text-ink-4">
                    {t("kpis.recovery.respond.notYoursToOpen")}
                  </p>
                ) : card.response.kind === "fix_now" ? (
                  <p className="text-sm text-ink">
                    <Link
                      href={`/tasks/${card.response.subjectId}`}
                      className="font-semibold text-brand-text hover:underline"
                    >
                      {card.response.title}
                    </Link>
                    {card.response.dueOn ? (
                      <span className="text-xs text-ink-3">
                        {" "}
                        {t("kpis.recovery.respond.dueOn", {
                          date: card.response.dueOn,
                        })}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-sm text-ink">
                    <span className="font-semibold">{card.response.title}</span>
                  </p>
                )}
                {card.response.subjectId !== null &&
                card.response.kind === "key_result" &&
                card.response.goalId ? (
                  <p className="flex min-w-0 gap-1.5 text-xs">
                    <span className="flex-none text-ink-4">
                      {t("kpis.recovery.respond.objective")}
                    </span>
                    <Link
                      href={`/goals/${card.response.goalId}`}
                      className="truncate text-brand-text hover:underline"
                    >
                      {card.response.goalTitle}
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-ink-3">
                  {t("kpis.recovery.respond.decideAResponse")}
                </p>
                {canEdit ? (
                  <div
                    data-testid="kpi-responses"
                    className="flex flex-col gap-2"
                  >
                    <details className="rounded-md border border-line p-2.5">
                      <summary className="cursor-pointer text-sm font-semibold text-ink">
                        {t("kpis.recovery.respond.fixItNow")}
                      </summary>
                      <p className="mt-1 text-xs text-ink-3">
                        {t("kpis.recovery.respond.fixItNowWhen")}
                      </p>
                      <ActionForm
                        action={fixKpiNow}
                        label={t("kpis.recovery.respond.fixItNowFor", {
                          kpi: card.title,
                        })}
                        className="mt-2 flex flex-col gap-2"
                      >
                        <input type="hidden" name="kpiId" value={card.kpiId} />
                        <div className="flex flex-wrap items-center gap-2.5">
                          <label
                            className="text-xs text-ink-3"
                            htmlFor={`fix-title-${card.kpiId}`}
                          >
                            {t("kpis.recovery.respond.task")}
                          </label>
                          <input
                            id={`fix-title-${card.kpiId}`}
                            name="title"
                            defaultValue={t("kpis.recovery.respond.fixTitle", {
                              kpi: card.title,
                            })}
                            className={`${FIELD} min-w-0 flex-1`}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <label
                            className="text-xs text-ink-3"
                            htmlFor={`fix-owner-${card.kpiId}`}
                          >
                            {t("kpis.recovery.respond.owner")}
                          </label>
                          <select
                            id={`fix-owner-${card.kpiId}`}
                            name="ownerId"
                            defaultValue={
                              card.ownerMemberId ?? workspace.memberId
                            }
                            className={FIELD}
                          >
                            {people.map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.name}
                              </option>
                            ))}
                          </select>
                          <DateInput
                            id={`fix-due-${card.kpiId}`}
                            label={t("kpis.recovery.respond.due")}
                            name="dueOn"
                            required
                            inputClassName="h-auto py-1 text-xs"
                          />
                          <label
                            className="text-xs text-ink-3"
                            htmlFor={`fix-space-${card.kpiId}`}
                          >
                            {t("kpis.recovery.respond.space")}
                          </label>
                          <select
                            id={`fix-space-${card.kpiId}`}
                            name="spaceId"
                            defaultValue={card.spaceId ?? spaces[0]?.id ?? ""}
                            className={FIELD}
                          >
                            {spaces.map((space) => (
                              <option key={space.id} value={space.id}>
                                {space.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <button
                            type="submit"
                            className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-on-brand"
                          >
                            {t("kpis.recovery.respond.createTheTask")}
                          </button>
                        </div>
                      </ActionForm>
                    </details>

                    <details className="rounded-md border border-line p-2.5">
                      <summary className="cursor-pointer text-sm font-semibold text-ink">
                        {t("kpis.recovery.respond.addAKeyResult")}
                      </summary>
                      <p className="mt-1 text-xs text-ink-3">
                        {t("kpis.recovery.respond.addAKeyResultWhen")}
                      </p>
                      {objectives.length === 0 ? (
                        <p className="mt-2 text-xs text-ink-4">
                          {t("kpis.recovery.respond.noOpenObjective")}
                        </p>
                      ) : (
                        <ActionForm
                          action={answerKpiWithKeyResult}
                          label={t("kpis.recovery.respond.addAKeyResultFor", {
                            kpi: card.title,
                          })}
                          className="mt-2 flex flex-col gap-2"
                        >
                          <input
                            type="hidden"
                            name="kpiId"
                            value={card.kpiId}
                          />
                          <input
                            type="hidden"
                            name="direction"
                            value={
                              recoveryDrafts.get(card.kpiId)?.keyResults[0]
                                ?.direction ?? "increase"
                            }
                          />
                          <div className="flex flex-wrap items-center gap-2.5">
                            <label
                              className="text-xs text-ink-3"
                              htmlFor={`kr-goal-${card.kpiId}`}
                            >
                              {t("kpis.recovery.respond.objective")}
                            </label>
                            <select
                              id={`kr-goal-${card.kpiId}`}
                              name="goalId"
                              className={`${FIELD} min-w-0 flex-1`}
                            >
                              {objectives.map((goal) => (
                                <option key={goal.id} value={goal.id}>
                                  {goal.title}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-wrap items-center gap-2.5">
                            <label
                              className="text-xs text-ink-3"
                              htmlFor={`kr-title-${card.kpiId}`}
                            >
                              {t("kpis.recovery.respond.keyResult")}
                            </label>
                            <input
                              id={`kr-title-${card.kpiId}`}
                              name="title"
                              defaultValue={
                                recoveryDrafts.get(card.kpiId)?.keyResults[0]
                                  ?.title ?? card.title
                              }
                              className={`${FIELD} min-w-0 flex-1`}
                            />
                          </div>
                          {/* guided-inputs §4.8: numbers, grouped as the
                              reader reads them, and nothing sent empty. */}
                          <div className="flex flex-wrap items-end gap-2.5">
                            <NumberInput
                              id={`kr-baseline-${card.kpiId}`}
                              label={t("kpis.recovery.respond.from")}
                              name="baseline"
                              defaultValue={
                                recoveryDrafts.get(card.kpiId)?.keyResults[0]
                                  ?.baseline ?? null
                              }
                              inputClassName="h-auto w-24 py-1 text-xs"
                            />
                            <NumberInput
                              id={`kr-target-${card.kpiId}`}
                              label={t("kpis.recovery.respond.to")}
                              name="target"
                              defaultValue={
                                recoveryDrafts.get(card.kpiId)?.keyResults[0]
                                  ?.target ?? null
                              }
                              inputClassName="h-auto w-24 py-1 text-xs"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2.5">
                            <label
                              className="text-xs text-ink-3"
                              htmlFor={`kr-reason-${card.kpiId}`}
                            >
                              {t("kpis.recovery.respond.whyNow")}
                            </label>
                            <input
                              id={`kr-reason-${card.kpiId}`}
                              name="reason"
                              className={`${FIELD} min-w-0 flex-1`}
                            />
                          </div>
                          <div>
                            <button
                              type="submit"
                              className="rounded-md bg-brand px-3 py-1 text-xs font-semibold text-on-brand"
                            >
                              {t("kpis.recovery.respond.addTheKeyResult")}
                            </button>
                          </div>
                        </ActionForm>
                      )}
                      {objectives.some((goal) => goal.keyResults.length > 0) ? (
                        <ActionForm
                          action={nameKpiKeyResult}
                          label={t("kpis.recovery.respond.alreadyAnsweredFor", {
                            kpi: card.title,
                          })}
                          className="mt-2 flex flex-wrap items-center gap-2.5 border-t border-line pt-2"
                        >
                          <input
                            type="hidden"
                            name="kpiId"
                            value={card.kpiId}
                          />
                          <label
                            className="text-xs text-ink-3"
                            htmlFor={`kr-existing-${card.kpiId}`}
                          >
                            {t("kpis.recovery.respond.orOneThatExists")}
                          </label>
                          <select
                            id={`kr-existing-${card.kpiId}`}
                            name="keyResultId"
                            className={`${FIELD} min-w-0 flex-1`}
                          >
                            {objectives.map((goal) =>
                              goal.keyResults.length === 0 ? null : (
                                <optgroup key={goal.id} label={goal.title}>
                                  {goal.keyResults.map((keyResult) => (
                                    <option
                                      key={keyResult.id}
                                      value={keyResult.id}
                                    >
                                      {keyResult.title}
                                    </option>
                                  ))}
                                </optgroup>
                              ),
                            )}
                          </select>
                          <button
                            type="submit"
                            className="rounded-md border border-line px-3 py-1 text-xs font-semibold text-ink-2"
                          >
                            {t("kpis.recovery.respond.thatOneAnswersIt")}
                          </button>
                        </ActionForm>
                      ) : null}
                    </details>

                    <details className="rounded-md border border-line p-2.5">
                      <summary className="cursor-pointer text-sm font-semibold text-ink">
                        {t("kpis.recovery.respond.launchARecovery")}
                      </summary>
                      <p className="mt-1 text-xs text-ink-3">
                        {t("kpis.recovery.respond.launchARecoveryWhen")}
                      </p>
                      <div className="mt-2 flex flex-col items-start gap-2">
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
                        <LaunchRecovery kpiId={card.kpiId} />
                      </div>
                    </details>
                  </div>
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
