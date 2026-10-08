import { MID_CYCLE_CALIBRATION } from "@openokr/method";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  type MessageValues,
} from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../lib/translations";

/**
 * Phase 6, run the cadence (UIUX-PLAN.md §6 S-11, P6-G15).
 *
 * **Every figure comes from a table that already existed.** Check-ins landed
 * at P3-T07, sessions at P4-T04, blockers at P3-T09 and the decision log at
 * P4-T09. Phase 6 rendered a card saying the view "arrives at P6-G15" while
 * naming those very tasks as done, which is what the gap audit recorded as
 * B-03: three of the eight phases were reachable in the rail and did nothing.
 *
 * **Nothing here writes.** Running the cadence happens on the check-in
 * screen, the session screen and the board; this is the phase's own answer
 * to "how is it going", assembled from those. It used to record the one
 * mid-cycle calibration METHOD.md §7.6 allowed (completeness review M-06).
 * METHOD v2 retired it at P9-T13-c-b: a target now moves at any time under
 * §2.9's one rule, each change with its own reason where it eases, so there
 * is nothing left to record once a cycle. A calibration recorded before that
 * is still shown, read-only, because it is history.
 *
 * **The rule shown is §7.6 itself**, from `packages/method`, and in
 * the document's language like the guidance rail beside it. A paraphrase here
 * would be a second statement of the practice.
 *
 * **Blocker age is in days and sorted oldest first**, because §6.3's ladder
 * escalates on age and a board sorted by anything else hides the one that has
 * been waiting longest.
 */

export interface SessionRow {
  readonly id: string;
  readonly kind: string;
  /**
   * Whether it has ended.
   *
   * A boolean rather than a status string, because a session has no status
   * column: `sessions.list` carries `startedAt` and `endedAt`, and "held"
   * is the second of those being set. Asking for a status here would have been
   * asking the read for something it does not know.
   */
  readonly closed: boolean;
  readonly scheduledFor: string | null;
  readonly spaceName: string;
}

export interface BlockerRow {
  readonly id: string;
  readonly title: string;
  readonly ageDays: number;
  readonly ownerName: string | null;
  readonly spaceName: string;
}

export interface DecisionRow {
  readonly id: string;
  readonly summary: string;
  readonly at: string;
}

/** What `workflow.read` returns for the cycle's one calibration. */
export interface CalibrationRecord {
  readonly reason: string;
  readonly at: string;
  readonly authorName: string | null;
}

export interface ConfidenceRow {
  readonly id: string;
  readonly title: string;
  readonly goalTitle: string;
  readonly confidence: number | null;
  readonly previousConfidence: number | null;
}

function trend(
  row: ConfidenceRow,
  t: (key: string, values?: MessageValues) => string,
): {
  readonly word: string;
  readonly tone: "ok" | "warn" | "bad" | "neutral";
} {
  if (row.confidence === null || row.previousConfidence === null) {
    return { word: t("cycle.runningCadence.noTrendYet"), tone: "neutral" };
  }
  const move = row.confidence - row.previousConfidence;
  if (move > 0) {
    return { word: t("cycle.runningCadence.up", { move }), tone: "ok" };
  }
  if (move < 0) {
    return {
      word: t("cycle.runningCadence.down", { move: Math.abs(move) }),
      tone: "bad",
    };
  }
  return { word: t("cycle.runningCadence.flat"), tone: "neutral" };
}

export async function RunningCadence({
  sessions,
  blockers,
  decisions,
  confidence,
  streak,
  calibration,
}: {
  readonly sessions: readonly SessionRow[];
  readonly blockers: readonly BlockerRow[];
  readonly decisions: readonly DecisionRow[];
  readonly confidence: readonly ConfidenceRow[];
  readonly streak: number;
  /** One recorded before calibration retired (P9-T13-c-b), or null. */
  readonly calibration: CalibrationRecord | null;
}) {
  const { t } = await getTranslations();
  const calibratedOn = calibration ? calibration.at.slice(0, 10) : null;

  const held = sessions.filter((one) => one.closed);
  const upcoming = sessions.filter((one) => !one.closed);

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("cycle.runningCadence.runningTheCadence")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("cycle.runningCadence.howTheCycleIs")}
            </p>
          </div>
          <div className="flex flex-none items-center gap-3.5">
            <div className="flex flex-col items-end">
              <span className="text-lg font-bold tabular-nums text-ink">
                {streak}
              </span>
              <span className="text-xs text-ink-3">
                {t("cycle.runningCadence.weekStreak")}
              </span>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h3 className="text-sm font-bold text-ink">{t("common.sessions")}</h3>
          <Chip tone={held.length > 0 ? "ok" : "neutral"}>
            {t("cycle.runningCadence.heldToCome", {
              length: held.length,
              length2: upcoming.length,
            })}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {sessions.length === 0 ? (
            <p className="text-xs text-ink-3">
              {t("cycle.runningCadence.noneScheduledInThis")}
            </p>
          ) : (
            sessions.map((session) => (
              <Link
                key={session.id}
                href={`/session/${session.id}`}
                className="flex items-center justify-between gap-2.5 rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:border-ink-4"
              >
                <span>
                  {session.kind}
                  <span className="ml-1.5 text-xs text-ink-3">
                    {session.spaceName}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-ink-3">
                  {session.scheduledFor
                    ? session.scheduledFor.slice(0, 10)
                    : t("cycle.runningCadence.unscheduled")}
                  <Chip tone={session.closed ? "ok" : "neutral"}>
                    {session.closed
                      ? t("cycle.runningCadence.held")
                      : t("cycle.runningCadence.toCome")}
                  </Chip>
                </span>
              </Link>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h3 className="text-sm font-bold text-ink">
            {t("common.confidence")}
          </h3>
          <span className="text-xs text-ink-3">
            {t("cycle.runningCadence.againstTheLastCheck")}
          </span>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {confidence.length === 0 ? (
            <p className="text-xs text-ink-3">
              {t("cycle.runningCadence.noKeyResultsWith")}
            </p>
          ) : (
            confidence.map((row) => {
              const moved = trend(row, t);
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2.5 border-t border-line pt-1.5 text-sm first:border-0 first:pt-0"
                >
                  <span className="min-w-0 text-ink">
                    {row.title}
                    <span className="ml-1.5 text-xs text-ink-3">
                      {row.goalTitle}
                    </span>
                  </span>
                  <span className="flex flex-none items-center gap-2">
                    <span className="tabular-nums text-ink-2">
                      {row.confidence === null ? "—" : row.confidence}
                    </span>
                    <Chip tone={moved.tone}>{moved.word}</Chip>
                  </span>
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h3 className="text-sm font-bold text-ink">
            {t("common.openBlockers")}
          </h3>
          <Chip tone={blockers.length > 0 ? "warn" : "ok"}>
            {blockers.length === 0
              ? t("cycle.runningCadence.noneOpen")
              : t("cycle.runningCadence.countOpen", {
                  count: blockers.length,
                })}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {blockers.length === 0 ? (
            <p className="text-xs text-ink-3">
              {t("cycle.runningCadence.nothingIsBlockedThe")}
            </p>
          ) : (
            blockers.map((blocker) => (
              <div
                key={blocker.id}
                className="flex items-center justify-between gap-2.5 border-t border-line pt-1.5 text-sm first:border-0 first:pt-0"
              >
                <span className="min-w-0 text-ink">
                  {blocker.title}
                  <span className="ml-1.5 text-xs text-ink-3">
                    {blocker.spaceName}
                    {blocker.ownerName ? ` · ${blocker.ownerName}` : ""}
                  </span>
                </span>
                <Chip tone={blocker.ageDays >= 14 ? "bad" : "warn"}>
                  {t("cycle.runningCadence.ageOld", {
                    days:
                      blocker.ageDays === 1
                        ? t("common.count.dayOne", { count: blocker.ageDays })
                        : t("common.count.dayOther", {
                            count: blocker.ageDays,
                          }),
                  })}
                </Chip>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h3 className="text-sm font-bold text-ink">
            {t("cycle.runningCadence.decisionsAndCalibration")}
          </h3>
          {calibratedOn ? (
            <Chip tone="neutral">
              {t("cycle.runningCadence.calibrated", {
                calibratedAt: calibratedOn,
              })}
            </Chip>
          ) : null}
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {decisions.length === 0 ? (
            <p className="text-xs text-ink-3">
              {t("cycle.runningCadence.noDecisionsRecordedAgainst")}
            </p>
          ) : (
            decisions.map((decision) => (
              <div
                key={decision.id}
                className="flex items-start justify-between gap-2.5 border-t border-line pt-1.5 text-sm first:border-0 first:pt-0"
              >
                <span className="min-w-0 text-ink-2">{decision.summary}</span>
                <span className="flex-none text-xs text-ink-3">
                  {decision.at.slice(0, 10)}
                </span>
              </div>
            ))
          )}
        </CardBody>
        <CardBody
          className="flex flex-col gap-2 border-line border-t"
          data-testid="calibration"
        >
          <p className="text-xs text-ink-3" data-testid="calibration-rule">
            {MID_CYCLE_CALIBRATION.map((sentence) => `${sentence}.`).join(" ")}
          </p>
          {calibration && calibratedOn ? (
            <div className="flex flex-col gap-1 rounded-md border border-line bg-raised p-2.5">
              <p className="text-sm text-ink" data-testid="calibration-reason">
                {calibration.reason}
              </p>
              <p className="text-xs text-ink-3">
                {calibration.authorName
                  ? t("cycle.runningCadence.calibratedBy", {
                      name: calibration.authorName,
                      date: calibratedOn,
                    })
                  : t("cycle.runningCadence.calibratedOn", {
                      date: calibratedOn,
                    })}
              </p>
              <p className="text-xs text-ink-4">
                {t("cycle.runningCadence.calibrationRetired")}
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
