import { type KeyResultDirection, trendForecast } from "@openokr/method";

/**
 * A key result's value history, drawn small, with the §3.6 forecast beside it
 * (UIUX-PLAN.md §4 S-14, P3-T10).
 *
 * **The forecast comes from `packages/method`, never from this file.** It is an
 * ordinary least squares fit over the values inside the §11 window, and a chart
 * that eyeballed a trend of its own would be a second opinion the product cannot
 * defend. If the fit says the key result is trending off track, that sentence
 * has a rule behind it.
 *
 * Two points are the minimum. One value is a starting position, not a trend, and
 * the engine returns null rather than drawing a line through a single dot.
 */

export interface HistoryPoint {
  readonly value: number;
  readonly at: string;
}

const WIDTH = 120;
const HEIGHT = 28;

export function Sparkline({
  history,
  direction,
  baseline,
  target,
  horizonAt,
}: {
  readonly history: readonly HistoryPoint[];
  readonly direction: KeyResultDirection;
  readonly baseline: number;
  readonly target: number;
  /**
   * The instant the fit projects to, on the same axis as the points: the
   * cycle end, or the key result's own due date. The same horizon the scoring
   * recompute passes, so the line here and the stored forecast cannot disagree.
   * Null when neither date exists, and then no forecast is drawn.
   */
  readonly horizonAt: number | null;
}) {
  if (history.length < 2) {
    return (
      <span className="text-xs text-ink-4">
        {history.length === 1
          ? "One value so far. A trend needs a second."
          : "No values recorded yet."}
      </span>
    );
  }

  const points = history
    .map((point) => ({
      at: new Date(point.at).getTime(),
      value: point.value,
    }))
    // Oldest first. `goals.keyResultHistory` answers newest first, which is
    // right for a table and backwards for a chart: plotted in that order the
    // line runs right to left, so a key result that climbed from 41 to 60
    // draws as a falling line. The read is not changed, because the table
    // wants what it returns; the chart sorts for itself.
    .sort((a, b) => a.at - b.at);
  const forecast =
    horizonAt === null
      ? null
      : trendForecast(points, horizonAt, { direction, baseline, target });

  // The date the projection lands on, spelled out beside the number. A bare
  // figure reads as a claim; "by 2026-09-30" reads as the straight line it is,
  // which matters most when two values a day apart extrapolate to something
  // wild. The arithmetic is the engine's and is not adjusted here.
  const horizonOn =
    horizonAt === null
      ? ""
      : (new Date(horizonAt).toISOString().slice(0, 10) ?? "");

  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const firstAt = points[0]?.at ?? 0;
  const lastAt = points[points.length - 1]?.at ?? 1;
  const width = lastAt - firstAt || 1;

  const path = points
    .map((point, index) => {
      const x = ((point.at - firstAt) / width) * WIDTH;
      // Inverted, because SVG's y grows downward and a rising value should rise.
      const y = HEIGHT - ((point.value - low) / span) * HEIGHT;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <span className="flex items-center gap-2">
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="flex-none overflow-hidden"
        role="img"
        aria-label={`${history.length} values, from ${values[0]} to ${
          values[values.length - 1]
        }`}
      >
        <title>Value history</title>
        <path
          d={path}
          fill="none"
          strokeWidth={1.5}
          className={
            forecast?.trendingOffTrack ? "stroke-bad" : "stroke-brand-strong"
          }
        />
      </svg>
      {forecast ? (
        <span
          className={
            forecast.trendingOffTrack
              ? "text-xs font-semibold text-bad"
              : "text-xs text-ink-3"
          }
        >
          {forecast.trendingOffTrack
            ? `Trending off track: ${round(forecast.projected)} by ${horizonOn}`
            : `On this trend: ${round(forecast.projected)} by ${horizonOn}`}
        </span>
      ) : (
        <span className="text-xs text-ink-4">
          No deadline to project to, or not enough distinct dates to fit a
          trend.
        </span>
      )}
    </span>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
