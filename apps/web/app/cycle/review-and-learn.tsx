import type { ResolvedThresholds } from "@openokr/method";
import { scoreBand } from "@openokr/method";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { ActionForm } from "./action-form.tsx";
import { runFeedForward } from "./frame-actions.ts";

/**
 * Phase 7, review and learn (UIUX-PLAN.md §6 S-12, P6-G16).
 *
 * **The arithmetic was already here and had no screen.** Scoring, the bands
 * and the portfolio average are `packages/method`, the archive and the
 * feed-forward are `cycles.snapshot` and `cycles.feedForward` from P3-T15, and
 * the retrospective is P4-T08's. Phase 7 rendered one sentence saying so. The
 * gap audit recorded it as the third of B-03's three phases.
 *
 * **The band table is highlighted at the portfolio average**, which is §8's
 * point: a set that averages 0.7 is a set that was ambitious and mostly
 * delivered, and reading one score against the band it falls in is how the
 * conversation stays about the practice rather than about the number.
 *
 * **Feed-forward is idempotent**, which is why the button says what running it
 * twice does. `cycles.feedForward` carries the scores and the flagged items
 * into the next cycle and running it again changes nothing, so a facilitator
 * who is unsure whether it worked can press it.
 */

export interface ScoredKeyResult {
  readonly id: string;
  readonly title: string;
  readonly goalTitle: string;
  readonly score: number | null;
  readonly carryForward: boolean;
}

/** The band names in the order §3.3 states them, worst last. */
const BAND_WORDS: Readonly<Record<string, string>> = {
  fully_achieved: "Fully achieved",
  strong: "Strong",
  partial: "Partial",
  little: "Little movement",
};

export function ReviewAndLearn({
  keyResults,
  cycleName,
  archivedAt,
  canEdit,
  thresholds,
}: {
  readonly keyResults: readonly ScoredKeyResult[];
  readonly cycleName: string;
  readonly archivedAt: string | null;
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
}) {
  const scored = keyResults.filter((one) => one.score !== null);
  const average =
    scored.length === 0
      ? null
      : scored.reduce((total, one) => total + (one.score ?? 0), 0) /
        scored.length;

  // The band the portfolio average falls in, decided by the method package
  // against this workspace's own thresholds.
  const band = average === null ? null : scoreBand(average, thresholds);
  const boundaries = thresholds["scoring.scoreBands"];
  const table: readonly (readonly [string, string])[] = [
    ["fully_achieved", `${boundaries.achieved.toFixed(2)} and above`],
    [
      "strong",
      `${boundaries.strong.toFixed(2)} to ${boundaries.achieved.toFixed(2)}`,
    ],
    [
      "partial",
      `${boundaries.partial.toFixed(2)} to ${boundaries.strong.toFixed(2)}`,
    ],
    ["little", `below ${boundaries.partial.toFixed(2)}`],
  ];

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">Review and learn</h2>
            <p className="text-xs text-ink-3">
              Closing {cycleName}. Every key result carries a score, the
              portfolio average lands in a band, and what is unfinished is
              flagged to carry.
            </p>
          </div>
          {archivedAt ? (
            <Chip tone="ok">archived {archivedAt.slice(0, 10)}</Chip>
          ) : (
            <Chip tone="neutral">open</Chip>
          )}
        </CardHeader>
        <CardBody className="flex flex-wrap items-end gap-6">
          <div className="flex flex-col">
            <span className="text-lg font-bold tabular-nums text-ink">
              {average === null ? "—" : average.toFixed(2)}
            </span>
            <span className="text-xs text-ink-3">portfolio average</span>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tabular-nums text-ink">
              {scored.length} of {keyResults.length}
            </span>
            <span className="text-xs text-ink-3">scored</span>
          </div>
          {band ? <Chip tone="info">{BAND_WORDS[band] ?? band}</Chip> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-sm font-bold text-ink">The bands</h3>
        </CardHeader>
        <CardBody className="flex flex-col gap-1">
          {table.map(([name, range]) => {
            const here = band === name;
            return (
              <div
                key={name}
                className={
                  here
                    ? "flex items-center justify-between gap-2.5 rounded-md bg-brand-weak px-2.5 py-1.5 text-sm text-brand-text"
                    : "flex items-center justify-between gap-2.5 px-2.5 py-1.5 text-sm text-ink-2"
                }
              >
                <span>{BAND_WORDS[name] ?? name}</span>
                <span className="tabular-nums text-xs">{range}</span>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h3 className="text-sm font-bold text-ink">Key results</h3>
          <span className="text-xs text-ink-3">
            Scoring happens on the goal, so this is the account of it
          </span>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {keyResults.length === 0 ? (
            <p className="text-xs text-ink-3">
              Nothing to score: this cycle has no key results.
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
                  {row.carryForward ? <Chip tone="warn">carry</Chip> : null}
                  <span className="tabular-nums text-ink-2">
                    {row.score === null ? "not scored" : row.score.toFixed(2)}
                  </span>
                </span>
              </div>
            ))
          )}
        </CardBody>
      </Card>

      {canEdit ? (
        <Card>
          <CardHeader>
            <div className="flex min-w-0 flex-col">
              <h3 className="text-sm font-bold text-ink">Feed forward</h3>
              <p className="text-xs text-ink-3">
                Opens the next cycle carrying these scores and every flagged
                item. Idempotent: running it twice changes nothing, so pressing
                it again when you are unsure is safe.
              </p>
            </div>
          </CardHeader>
          <CardBody>
            <ActionForm action={runFeedForward}>
              <Button type="submit" variant="default" size="sm">
                Carry into the next cycle
              </Button>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
