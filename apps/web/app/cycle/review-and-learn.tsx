import type { ResolvedThresholds, ScoreColoursPractice } from "@openokr/method";
import { scoreBand, scoreBandsIn } from "@openokr/method";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getTranslations } from "../../lib/translations";
import { verdictLabel, verdictTone } from "../../lib/verdict";
import { ActionForm } from "./action-form.tsx";
import { closeCycle } from "./frame-actions.ts";

/**
 * Phase 7, review and learn (UIUX-PLAN.md §6 S-12, P6-G16).
 *
 * **The arithmetic was already here and had no screen.** Scoring, the bands
 * and the portfolio average are `packages/method`, the archive and the
 * feed-forward are P3-T15's, and the retrospective is P4-T08's. Phase 7
 * rendered one sentence saying so. The gap audit recorded it as the third of
 * B-03's three phases.
 *
 * **The band table is highlighted at the portfolio average**, which is §8's
 * point: a set that averages 0.7 is a set that was ambitious and mostly
 * delivered, and reading one score against the band it falls in is how the
 * conversation stays about the practice rather than about the number.
 *
 * **Closing is one control** (M-05). §8.9: "At close, the product feeds the
 * next cycle automatically." It was a feed-forward button here and a snapshot
 * button on the scorecard, and nothing set a cycle to closed. Now the close
 * records the result and feeds the next cycle together, and once closed this
 * card shows both: the verdict, and what the next cycle received.
 */

export interface ScoredKeyResult {
  readonly id: string;
  readonly title: string;
  readonly goalTitle: string;
  readonly score: number | null;
  readonly carryForward: boolean;
}

/** How a closed cycle closed, as `workflow.read` reads it back. */
export interface Closure {
  readonly resultValue: number | null;
  readonly verdict: string | null;
  readonly nextCycle: { readonly id: string; readonly name: string } | null;
  readonly priorScores: number;
  readonly carriedIssues: number;
  readonly processPriority: string | null;
  readonly packNote: boolean;
}

/** The band names in the order §3.3 states them, worst last. */
function bandWord(band: string, t: (key: string) => string): string {
  switch (band) {
    case "fully_achieved":
      return t("cycle.reviewAndLearn.band.fullyAchieved");
    case "strong":
      return t("common.strong");
    case "partial":
      return t("cycle.reviewAndLearn.band.partial");
    case "little":
      return t("cycle.reviewAndLearn.band.little");
    default:
      return band;
  }
}

export async function ReviewAndLearn({
  keyResults,
  cycleId,
  cycleName,
  closure,
  waitingFor,
  canEdit,
  thresholds,
  practice,
}: {
  readonly keyResults: readonly ScoredKeyResult[];
  readonly cycleId: string;
  readonly cycleName: string;
  /** Null while the cycle is open. */
  readonly closure: Closure | null;
  /**
   * What phase 7 still needs before the cycle can close, in the rail's own
   * words. Empty when it is complete. The server refuses on the same
   * evaluation, so this only saves somebody pressing a control that will say
   * no.
   */
  readonly waitingFor: readonly string[];
  readonly canEdit: boolean;
  /**
   * This workspace's resolved §11 thresholds.
   *
   * Passed in rather than read from the canon here, because a workspace that
   * moved its own band boundaries would otherwise be shown the defaults. The
   * first draft of this file invented a `SCORE_BANDS` constant that does not
   * exist, which is exactly the hardcoding the method rule forbids.
   */
  readonly thresholds: ResolvedThresholds;
  /** Which colours the bands are read in (§12 "Score colours"). */
  readonly practice: ScoreColoursPractice;
}) {
  const { t } = await getTranslations();

  const scored = keyResults.filter((one) => one.score !== null);
  const average =
    scored.length === 0
      ? null
      : scored.reduce((total, one) => total + (one.score ?? 0), 0) /
        scored.length;

  // The band the portfolio average falls in, decided by the method package
  // against this workspace's own thresholds.
  const band =
    average === null ? null : scoreBand(average, thresholds, practice);
  // In the workspace's score colours (§3.3, §12, P9-T14a).
  const boundaries = scoreBandsIn(thresholds, practice);
  const table: readonly (readonly [string, string])[] = [
    [
      "fully_achieved",
      t("cycle.reviewAndLearn.rangeAndAbove", {
        value: boundaries.achieved.toFixed(2),
      }),
    ],
    [
      "strong",
      t("cycle.reviewAndLearn.rangeBetween", {
        low: boundaries.strong.toFixed(2),
        high: boundaries.achieved.toFixed(2),
      }),
    ],
    [
      "partial",
      t("cycle.reviewAndLearn.rangeBetween", {
        low: boundaries.partial.toFixed(2),
        high: boundaries.strong.toFixed(2),
      }),
    ],
    [
      "little",
      t("cycle.reviewAndLearn.rangeBelow", {
        value: boundaries.partial.toFixed(2),
      }),
    ],
  ];

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("cycle.reviewAndLearn.reviewAndLearn")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("cycle.reviewAndLearn.closingEveryKeyResultCarries", {
                cycleName,
              })}
            </p>
          </div>
          {closure ? (
            <Chip tone="ok">{t("cycle.reviewAndLearn.closed")}</Chip>
          ) : (
            <Chip tone="neutral">{t("common.open")}</Chip>
          )}
        </CardHeader>
        <CardBody className="flex flex-wrap items-end gap-6">
          <div className="flex flex-col">
            <span className="text-lg font-bold tabular-nums text-ink">
              {average === null ? "—" : average.toFixed(2)}
            </span>
            <span className="text-xs text-ink-3">
              {t("cycle.reviewAndLearn.portfolioAverage")}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tabular-nums text-ink">
              {t("common.of4", {
                length: scored.length,
                length2: keyResults.length,
              })}
            </span>
            <span className="text-xs text-ink-3">
              {t("cycle.reviewAndLearn.scored")}
            </span>
          </div>
          {band ? <Chip tone="info">{bandWord(band, t)}</Chip> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-bold text-ink">
            {t("cycle.reviewAndLearn.theBands")}
          </h3>
        </CardHeader>
        <CardBody className="flex flex-col gap-1">
          {table.map(([name, range]) => {
            const here = band === name;
            return (
              <div
                key={name}
                data-testid="score-band-row"
                data-band={name}
                className={
                  here
                    ? "flex items-center justify-between gap-2.5 rounded-md bg-brand-weak px-2.5 py-1.5 text-sm text-brand-text"
                    : "flex items-center justify-between gap-2.5 px-2.5 py-1.5 text-sm text-ink-2"
                }
              >
                <span>{bandWord(name, t)}</span>
                <span className="tabular-nums text-xs">{range}</span>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h3 className="text-sm font-bold text-ink">
            {t("cycle.reviewAndLearn.keyResults")}
          </h3>
          <span className="text-xs text-ink-3">
            {t("cycle.reviewAndLearn.scoringHappensOnThe")}
          </span>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {keyResults.length === 0 ? (
            <p className="text-xs text-ink-3">
              {t("cycle.reviewAndLearn.nothingToScoreThis")}
            </p>
          ) : (
            keyResults.map((row) => (
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
                  {row.carryForward ? (
                    <Chip tone="warn">{t("cycle.reviewAndLearn.carry")}</Chip>
                  ) : null}
                  <span className="tabular-nums text-ink-2">
                    {row.score === null
                      ? t("cycle.reviewAndLearn.notScored")
                      : row.score.toFixed(2)}
                  </span>
                </span>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {closure ? (
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h3 className="text-sm font-bold text-ink">
                {t("cycle.reviewAndLearn.close.closedTitle")}
              </h3>
              <p className="text-xs text-ink-3">
                {t("cycle.reviewAndLearn.close.closedExplains")}
              </p>
            </div>
            <Chip tone={verdictTone(closure.verdict)} dot>
              {verdictLabel(closure.verdict)}
            </Chip>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-col">
              <span className="text-lg font-bold tabular-nums text-ink">
                {closure.resultValue === null
                  ? "—"
                  : closure.resultValue.toFixed(2)}
              </span>
              <span className="text-xs text-ink-3">
                {t("cycle.reviewAndLearn.close.result")}
              </span>
            </div>
            {closure.nextCycle ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm text-ink">
                  {t("cycle.reviewAndLearn.close.fedInto", {
                    next: closure.nextCycle.name,
                  })}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-ink-3">
                    {t("cycle.reviewAndLearn.close.priorScores")}
                  </dt>
                  <dd className="tabular-nums text-ink">
                    {closure.priorScores}
                  </dd>
                  <dt className="text-ink-3">
                    {t("cycle.reviewAndLearn.close.carriedIssues")}
                  </dt>
                  <dd className="tabular-nums text-ink">
                    {closure.carriedIssues}
                  </dd>
                  <dt className="text-ink-3">
                    {t("cycle.reviewAndLearn.close.processPriority")}
                  </dt>
                  <dd className="text-ink">
                    {closure.processPriority ??
                      t("cycle.reviewAndLearn.close.noProcessPriority")}
                  </dd>
                  <dt className="text-ink-3">
                    {t("cycle.reviewAndLearn.close.inputPack")}
                  </dt>
                  <dd className="text-ink">
                    {closure.packNote
                      ? t("cycle.reviewAndLearn.close.learningsAdded")
                      : t("cycle.reviewAndLearn.close.noLearnings")}
                  </dd>
                </dl>
              </div>
            ) : (
              <p className="text-xs text-ink-3">
                {t("cycle.reviewAndLearn.close.nextNotCreated")}
              </p>
            )}
          </CardBody>
        </Card>
      ) : canEdit ? (
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h3 className="text-sm font-bold text-ink">
                {t("cycle.reviewAndLearn.close.title")}
              </h3>
              <p className="text-xs text-ink-3">
                {t("cycle.reviewAndLearn.close.explains")}
              </p>
            </div>
          </CardHeader>
          <CardBody>
            {/* Disabled with the reason beside it, never silently inert
                (UIUX-PLAN §3, the rule the publish control follows). */}
            <ActionForm action={closeCycle} className="flex flex-col gap-1.5">
              <input type="hidden" name="cycleId" value={cycleId} />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="w-fit"
                disabled={waitingFor.length > 0}
              >
                {t("cycle.reviewAndLearn.close.button", { cycleName })}
              </Button>
              {waitingFor.length > 0 ? (
                <div className="flex flex-col gap-0.5 text-xs text-ink-3">
                  <p>{t("cycle.reviewAndLearn.close.waiting")}</p>
                  <ul className="list-disc pl-4">
                    {waitingFor.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
