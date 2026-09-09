import type { ResolvedThresholds } from "@openokr/method";
import { confidenceBand } from "@openokr/method";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";

/**
 * A space's weekly figures: the confidence trend and the streak
 * (S-22 and the space home, P6-G19b and P6-G19c).
 *
 * In `lib` rather than under a route because two screens ask the same
 * question. The session screen shows it to the room that is about to meet; the
 * space home shows it to anybody who opens the team.
 *
 * **These tables shipped at P4-T07b and P4-T08 and nothing read them.** The
 * screen carried a sentence saying the panels would arrive and naming the
 * tasks that had already built the storage, which is what the gap audit
 * recorded as B-10.
 *
 * **The trend is drawn short when the history is short.** A space four weeks
 * old has four points. Padding to twelve with zeroes would draw a collapse
 * that never happened, and a team reading their own screen would be looking
 * at a lie about their first month.
 *
 * **The bar's colour is §3.2's band, decided by the method package.** The
 * first draft of this file compared against 0.7 and 0.4 written out here,
 * which is the same hardcoding P6-G19a had just removed from the stage gate
 * two files away, and it would have coloured a workspace that moved its own
 * boundaries by the canon's.
 *
 * Server component: nothing here is interactive, and the blocker controls
 * that are live in their own client component beside it.
 */

export interface TrendPoint {
  readonly weekStart: string;
  /** 0 to 1, in §3.2's scale. */
  readonly average: number;
}

/**
 * A sparkline in plain elements rather than a chart library.
 *
 * Twelve bars is not a chart. Adding a runtime dependency for it would need
 * asking (CLAUDE.md), and would put a canvas where a screen reader currently
 * reads a list of weeks and figures.
 */
function Sparkline({
  points,
  thresholds,
}: {
  readonly points: readonly TrendPoint[];
  readonly thresholds: ResolvedThresholds;
}) {
  return (
    <ol data-testid="confidence-trend" className="flex items-end gap-1.5">
      {points.map((point) => {
        // A floor so a genuinely low week is still a visible bar rather than
        // nothing at all, which reads as missing data.
        const height = Math.max(6, Math.round(point.average * 56));
        const { band } = confidenceBand(point.average, thresholds);
        return (
          <li
            key={point.weekStart}
            className="flex flex-col items-center gap-1"
            title={`${point.weekStart}: ${point.average.toFixed(2)}`}
          >
            <span
              aria-hidden="true"
              style={{ height: `${height}px` }}
              className={
                band === "high"
                  ? "w-4 rounded-t-sm bg-ok-dot"
                  : band === "medium"
                    ? "w-4 rounded-t-sm bg-warn-dot"
                    : "w-4 rounded-t-sm bg-bad-dot"
              }
            />
            <span className="text-[10px] tabular-nums text-ink-4">
              {point.weekStart.slice(5)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function WeeklyFigures({
  trend,
  streakWeeks,
  weeks,
  thresholds,
}: {
  readonly trend: readonly TrendPoint[];
  readonly streakWeeks: number;
  /** The window asked for, so an empty trend can say what is missing. */
  readonly weeks: number;
  /** This workspace's resolved §11 numbers, for §3.2's bands. */
  readonly thresholds: ResolvedThresholds;
}) {
  const latest = trend.at(-1) ?? null;
  const previous = trend.at(-2) ?? null;
  const move = latest && previous ? latest.average - previous.average : null;

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">Confidence trend</h2>
            <p className="text-xs text-ink-3">
              One point per week this space held a session, oldest first. The
              figure is the average the digest recorded, not a second sum.
            </p>
          </div>
          <div className="flex flex-none items-center gap-3.5">
            <div className="flex flex-col items-end">
              <span className="text-lg font-bold tabular-nums text-ink">
                {streakWeeks}
              </span>
              <span className="text-xs text-ink-3">week streak</span>
            </div>
            {move === null ? null : (
              <Chip tone={move > 0 ? "ok" : move < 0 ? "bad" : "neutral"}>
                {move > 0
                  ? `up ${move.toFixed(2)}`
                  : move < 0
                    ? `down ${Math.abs(move).toFixed(2)}`
                    : "flat"}
              </Chip>
            )}
          </div>
        </CardHeader>
        <CardBody>
          {trend.length === 0 ? (
            <p className="text-xs text-ink-3">
              No week has been closed yet. The first point lands when this
              session closes and writes its digest.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Sparkline points={trend} thresholds={thresholds} />
              <p className="text-xs text-ink-4">
                {trend.length === 1
                  ? "One week so far."
                  : `${trend.length} of the last ${weeks} weeks. A week with no session is not a point.`}
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
