"use client";

/**
 * The monthly review (UIUX-PLAN.md S-23, METHOD.md §7.5, P4-T09).
 *
 * Five panels, one per line of §7.5's table: a trend per objective, the
 * dependency and risk log, the resource or priority shifts, continue, update,
 * start or stop, and the decisions.
 *
 * **The trend is a human judgement and the screen keeps it one.** No button
 * starts selected. §3.7's progress signal sits beside each objective as
 * evidence, because a facilitator asking "is this improving" needs the numbers
 * in front of them, and never as a pre-selected answer they only have to
 * confirm. A pre-filled judgement is a judgement most rooms stop making.
 *
 * **The dependency log is read, not recorded.** It comes from the alignment
 * register P3-T09 already keeps. A second copy filled in here would give a
 * facilitator two answers about one dependency.
 *
 * **The moves are read the same way** (P9-T19a-d-d). A start, an update and a
 * stop are each the write §2.9 already keeps, so the panel lists them from the
 * objective and offers the one move that belongs in the room, the stop, through
 * the same `goals.stop` the objective's page calls. Continue needs no record,
 * and an update is made on the objective, where easing a target asks for its
 * reason.
 */
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  recordDecisionAction,
  setShiftsAction,
  setTrendAction,
  stopObjectiveAction,
} from "./actions";

/** `labelKey` is a catalogue key, so the words are the reader's language. */
const TRENDS = [
  { value: "improving", labelKey: "session.detail.monthlyReview.improving" },
  { value: "flat", labelKey: "session.detail.monthlyReview.flat" },
  { value: "declining", labelKey: "cycle.baseline.declining" },
] as const;

const SIGNAL_TONE: Record<string, "ok" | "warn" | "bad"> = {
  green: "ok",
  amber: "warn",
  red: "bad",
};

export interface MonthlyTrend {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly trend: string;
  readonly signal: string | null;
  readonly progressPct: number;
}

export interface MonthlyUntrended {
  readonly goalId: string;
  readonly goalTitle: string;
}

export interface MonthlyDependency {
  readonly id: string;
  readonly keyResultId: string;
  readonly keyResultTitle: string;
  readonly description: string;
  readonly confirmed: boolean;
  readonly riskOwnerId: string | null;
}

export interface MonthlyDecision {
  readonly id: string;
  readonly text: string;
  readonly at: string;
  readonly authorName: string;
  readonly goalId: string | null;
  readonly goalTitle: string | null;
  readonly keyResultId: string | null;
  readonly keyResultTitle: string | null;
}

/** One start mid-cycle in the review's scope (METHOD.md §2.9, P9-T13-a). */
export interface MonthlyAddition {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly keyResultId: string | null;
  readonly keyResultTitle: string | null;
  readonly addedAt: string;
}

/** One stop in the review's scope (METHOD.md §2.9, P9-T19a-d-d). */
export interface MonthlyStop {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly reason: string | null;
  readonly stoppedAt: string;
}

/** One target updated after the plan was published (METHOD.md §2.9). */
export interface MonthlyUpdate {
  readonly goalId: string;
  readonly goalTitle: string;
  readonly keyResultId: string;
  readonly keyResultTitle: string;
  readonly from: number;
  readonly to: number;
  readonly eased: boolean;
  readonly reason: string | null;
  readonly changedAt: string;
}

export interface DecisionSubject {
  readonly kind: "goal" | "keyResult";
  readonly id: string;
  readonly label: string;
}

export function MonthlyReview({
  sessionId,
  shifts,
  trends,
  untrended,
  additions,
  stops,
  updates,
  dependencies,
  decisions,
  subjects,
  canEdit,
}: {
  readonly sessionId: string;
  readonly shifts: string | null;
  readonly trends: readonly MonthlyTrend[];
  readonly untrended: readonly MonthlyUntrended[];
  /** What was started mid-cycle, read beside the decisions that made it. */
  readonly additions: readonly MonthlyAddition[];
  readonly stops: readonly MonthlyStop[];
  readonly updates: readonly MonthlyUpdate[];
  readonly dependencies: readonly MonthlyDependency[];
  readonly decisions: readonly MonthlyDecision[];
  readonly subjects: readonly DecisionSubject[];
  readonly canEdit: boolean;
}) {
  const { t } = useTranslations();

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [shiftsDraft, setShiftsDraft] = useState(shifts ?? "");
  const [decisionText, setDecisionText] = useState("");
  const [stopGoalId, setStopGoalId] = useState("");
  const [stopReason, setStopReason] = useState("");
  const [subjectKey, setSubjectKey] = useState(
    subjects[0] ? `${subjects[0].kind}:${subjects[0].id}` : "",
  );

  const run = useCallback(
    (work: () => Promise<unknown>) => {
      setProblem(null);
      startTransition(async () => {
        try {
          await work();
          router.refresh();
        } catch (error) {
          setProblem(
            error instanceof Error
              ? error.message
              : t("session.detail.thatDidNotSave"),
          );
        }
      });
    },
    [router, t],
  );

  const recorded = new Map(trends.map((entry) => [entry.goalId, entry]));
  const objectives = [
    ...trends.map((entry) => ({
      goalId: entry.goalId,
      goalTitle: entry.goalTitle,
    })),
    ...untrended,
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          {t("session.detail.monthlyReview.trendPerObjective")}
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {objectives.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("session.detail.monthlyReview.noObjectivesInThis")}
            </p>
          ) : null}
          {objectives.map((objective) => {
            const entry = recorded.get(objective.goalId);
            return (
              <div
                key={objective.goalId}
                className="flex flex-col gap-1.5 rounded-md border border-line p-2.5"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/goals/${objective.goalId}`}
                    className="text-sm font-medium text-ink"
                  >
                    {objective.goalTitle}
                  </Link>
                  {/* Evidence, beside the judgement and never instead of it
                      (§3.7). */}
                  {entry?.signal ? (
                    <Chip tone={SIGNAL_TONE[entry.signal] ?? "neutral"}>
                      {Math.round(entry.progressPct)}% · {entry.signal}
                    </Chip>
                  ) : null}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {TRENDS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={
                        entry?.trend === option.value ? "primary" : "default"
                      }
                      disabled={pending || !canEdit}
                      onClick={() =>
                        run(() =>
                          setTrendAction(
                            sessionId,
                            objective.goalId,
                            option.value,
                          ),
                        )
                      }
                    >
                      {t(option.labelKey)}
                    </Button>
                  ))}
                  {entry ? null : (
                    <span className="self-center text-xs text-ink-4">
                      {t("session.detail.monthlyReview.notRecordedYet")}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          {t("session.detail.monthlyReview.dependencyAndRiskLog")}
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          {dependencies.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("session.detail.monthlyReview.nothingInTheRegister")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dependencies.map((dependency) => (
                <li
                  key={dependency.id}
                  className="flex flex-col gap-1 rounded-md border border-line p-2.5"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-ink">
                      {dependency.keyResultTitle}
                    </span>
                    <Chip tone={dependency.confirmed ? "ok" : "warn"}>
                      {dependency.confirmed
                        ? t("common.confirmed")
                        : t("session.detail.monthlyReview.unconfirmed")}
                    </Chip>
                    {dependency.confirmed || dependency.riskOwnerId ? null : (
                      // §5.4: unconfirmed and unowned is what holds publish
                      // gate 4 red, so the screen names it rather than leaving
                      // a reader to work out why the gate will not open.
                      <Chip tone="bad">
                        {t("session.detail.monthlyReview.noRiskOwner")}
                      </Chip>
                    )}
                  </span>
                  {dependency.description ? (
                    <span className="text-xs text-ink-2">
                      {dependency.description}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          {t("session.detail.monthlyReview.resourceOrPriorityShifts")}
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <textarea
            className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
            value={shiftsDraft}
            disabled={!canEdit}
            aria-label={t(
              "session.detail.monthlyReview.resourceOrPriorityShifts",
            )}
            placeholder={t("session.detail.monthlyReview.whatMovedAndWhy")}
            onChange={(event) => setShiftsDraft(event.target.value)}
          />
          {canEdit ? (
            <span>
              <Button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(() => setShiftsAction(sessionId, shiftsDraft))
                }
              >
                {t("common.saveTheNote")}
              </Button>
            </span>
          ) : null}
        </CardBody>
      </Card>

      <Card data-testid="monthly-moves">
        <CardHeader>
          {t("session.detail.monthlyReview.continueUpdateStartOrStop")}
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-xs text-ink-4">
            {t("session.detail.monthlyReview.movesIntro")}
          </p>

          {additions.length + updates.length + stops.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("session.detail.monthlyReview.noMovesYet")}
            </p>
          ) : null}

          {additions.length > 0 ? (
            // §2.9: starts are evidence the review reads, beside the decisions
            // that made them, not a failure it hides.
            <section
              data-testid="mid-cycle-additions"
              className="flex flex-col gap-1.5"
            >
              <h3 className="text-xs font-medium text-ink-3">
                {t("session.detail.monthlyReview.started")}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {additions.map((addition) => (
                  <li
                    key={addition.keyResultId ?? addition.goalId}
                    className="flex flex-wrap items-center gap-2 text-sm text-ink"
                  >
                    <span>{addition.keyResultTitle ?? addition.goalTitle}</span>
                    {addition.keyResultTitle ? (
                      <span className="text-xs text-ink-3">
                        {addition.goalTitle}
                      </span>
                    ) : null}
                    <Chip tone="info">
                      {t("midCycle.addedOn", {
                        date: addition.addedAt.slice(0, 10),
                      })}
                    </Chip>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {updates.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-ink-3">
                {t("session.detail.monthlyReview.updated")}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {updates.map((update) => (
                  <li
                    key={`${update.keyResultId}:${update.changedAt}`}
                    className="flex flex-col gap-1 text-sm text-ink"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{update.keyResultTitle}</span>
                      <Chip tone={update.eased ? "warn" : "neutral"}>
                        {t("session.detail.monthlyReview.targetFromTo", {
                          from: String(update.from),
                          to: String(update.to),
                        })}
                      </Chip>
                      {update.eased ? (
                        <Chip tone="warn">
                          {t("session.detail.monthlyReview.eased")}
                        </Chip>
                      ) : null}
                    </span>
                    <span className="text-xs text-ink-3">
                      {update.goalTitle} · {update.changedAt.slice(0, 10)}
                      {update.reason ? ` · ${update.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {stops.length > 0 ? (
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-ink-3">
                {t("session.detail.monthlyReview.stopped")}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {stops.map((stop) => (
                  <li
                    key={stop.goalId}
                    className="flex flex-col gap-1 text-sm text-ink"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/goals/${stop.goalId}`}>
                        {stop.goalTitle}
                      </Link>
                      <Chip tone="neutral">
                        {t("session.detail.monthlyReview.stoppedOn", {
                          date: stop.stoppedAt.slice(0, 10),
                        })}
                      </Chip>
                    </span>
                    {stop.reason ? (
                      <span className="text-xs text-ink-3">{stop.reason}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {canEdit && objectives.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
              <label
                className="text-xs font-medium text-ink-3"
                htmlFor="stop-objective"
              >
                {t("session.detail.monthlyReview.objectiveToStop")}
              </label>
              <select
                id="stop-objective"
                className="rounded-md border border-line bg-surface p-2 text-sm text-ink"
                value={stopGoalId}
                onChange={(event) => setStopGoalId(event.target.value)}
              >
                {/* Nothing chosen to begin with: a stop closes an objective,
                    and the first in the list is not a default anybody chose. */}
                <option value="">
                  {t("session.detail.monthlyReview.chooseAnObjective")}
                </option>
                {objectives.map((objective) => (
                  <option key={objective.goalId} value={objective.goalId}>
                    {objective.goalTitle}
                  </option>
                ))}
              </select>
              <label
                className="text-xs font-medium text-ink-3"
                htmlFor="stop-reason"
              >
                {t("okrList.stopReason")}
              </label>
              <input
                id="stop-reason"
                className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                value={stopReason}
                maxLength={280}
                onChange={(event) => setStopReason(event.target.value)}
              />
              <span>
                <Button
                  type="button"
                  disabled={
                    pending ||
                    stopGoalId === "" ||
                    stopReason.trim().length === 0
                  }
                  onClick={() =>
                    run(async () => {
                      await stopObjectiveAction(
                        sessionId,
                        stopGoalId,
                        stopReason.trim(),
                      );
                      setStopGoalId("");
                      setStopReason("");
                    })
                  }
                >
                  {t("session.detail.monthlyReview.stopTheObjective")}
                </Button>
              </span>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("common.decisions")}</CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-xs text-ink-4">
            {t("session.detail.monthlyReview.theRecordThatSurvives")}
          </p>

          {decisions.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("session.detail.monthlyReview.nothingDecidedYet")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {decisions.map((decision) => (
                <li
                  key={decision.id}
                  className="flex flex-col gap-1 rounded-md border border-line p-2.5"
                >
                  <span className="text-sm text-ink">{decision.text}</span>
                  <span className="text-xs text-ink-3">
                    {decision.keyResultTitle ?? decision.goalTitle} ·{" "}
                    {new Date(decision.at).toLocaleDateString()} ·{" "}
                    {decision.authorName}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canEdit && subjects.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
              <label
                className="text-xs font-medium text-ink-3"
                htmlFor="decision-subject"
              >
                {t("session.detail.monthlyReview.whatItAffects")}
              </label>
              <select
                id="decision-subject"
                className="rounded-md border border-line bg-surface p-2 text-sm text-ink"
                value={subjectKey}
                onChange={(event) => setSubjectKey(event.target.value)}
              >
                {subjects.map((subject) => (
                  <option
                    key={`${subject.kind}:${subject.id}`}
                    value={`${subject.kind}:${subject.id}`}
                  >
                    {subject.label}
                  </option>
                ))}
              </select>
              <label
                className="text-xs font-medium text-ink-3"
                htmlFor="decision-text"
              >
                {t("session.detail.monthlyReview.theDecision")}
              </label>
              <textarea
                id="decision-text"
                className="min-h-20 w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                value={decisionText}
                placeholder={t("session.detail.monthlyReview.whatWasDecided")}
                onChange={(event) => setDecisionText(event.target.value)}
              />
              <span>
                <Button
                  type="button"
                  variant="primary"
                  disabled={pending || decisionText.trim().length === 0}
                  onClick={() => {
                    const [kind, id] = subjectKey.split(":");
                    run(async () => {
                      await recordDecisionAction(sessionId, {
                        ...(kind === "keyResult"
                          ? { keyResultId: id }
                          : { goalId: id }),
                        text: decisionText.trim(),
                      });
                      setDecisionText("");
                    });
                  }}
                >
                  {t("session.detail.monthlyReview.recordTheDecision")}
                </Button>
              </span>
            </div>
          ) : null}

          {problem === null ? null : (
            <p className="text-sm text-bad">{problem}</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
