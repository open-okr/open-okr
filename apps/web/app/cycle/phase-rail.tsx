import { PHASE_GUIDANCE } from "@openokr/method";
import { Bar, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";

/**
 * The eight phases down the left of the cycle workspace (UIUX-PLAN.md §4 S-04:
 * "a completion mark, the output each produces and a progress bar").
 *
 * Three states, not two. A phase that does not apply to this mode is drawn
 * differently from one still to do, because sending a facilitator to fix phase 0
 * in a quarterly cycle wastes their afternoon. The mark comes from the phase
 * evaluator, never from a stored boolean: METHOD.md §2.3 says the product
 * computes completion and it is not self-reported.
 */

export interface PhaseSummary {
  readonly phase: number;
  readonly title: string;
  readonly state: "pass" | "todo" | "not_applicable";
  readonly conditions: { readonly met: number; readonly total: number };
}

function Mark({
  phase,
  state,
  current,
}: {
  readonly phase: number;
  readonly state: PhaseSummary["state"];
  readonly current: boolean;
}) {
  const base =
    "flex size-6 flex-none items-center justify-center rounded-full text-xs font-bold";
  if (state === "pass") {
    return (
      <span
        role="img"
        className={`${base} bg-ok text-white`}
        aria-label={`Phase ${phase} is complete`}
      >
        ✓
      </span>
    );
  }
  if (state === "not_applicable") {
    return (
      <span
        role="img"
        className={`${base} bg-raised text-ink-4`}
        aria-label={`Phase ${phase} does not apply to this cycle`}
      >
        –
      </span>
    );
  }
  return (
    <span
      role="img"
      className={
        current
          ? `${base} bg-brand text-white`
          : `${base} border border-line bg-surface text-ink-3`
      }
      aria-label={`Phase ${phase} is not complete`}
    >
      {phase}
    </span>
  );
}

export function PhaseRail({
  phases,
  currentPhase,
}: {
  readonly phases: readonly PhaseSummary[];
  readonly currentPhase: number;
}) {
  const applicable = phases.filter((entry) => entry.state !== "not_applicable");
  const done = applicable.filter((entry) => entry.state === "pass").length;

  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">The cycle</h2>
        <Chip tone={done === applicable.length ? "ok" : "brand"}>
          {done} of {applicable.length} done
        </Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-1 p-2">
        {phases.map((entry) => {
          const guidance = PHASE_GUIDANCE.find(
            (item) => item.phase === entry.phase,
          );
          const current = entry.phase === currentPhase;
          const { met, total } = entry.conditions;
          return (
            <Link
              key={entry.phase}
              href={`/cycle?phase=${entry.phase}`}
              aria-current={current ? "step" : undefined}
              className={
                current
                  ? "flex items-start gap-2.5 rounded-md border border-brand-line bg-brand-weak p-2.5"
                  : "flex items-start gap-2.5 rounded-md border border-transparent p-2.5 hover:bg-raised"
              }
            >
              <Mark phase={entry.phase} state={entry.state} current={current} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span
                  className={
                    current
                      ? "text-sm font-bold text-brand-text"
                      : "text-sm font-semibold text-ink"
                  }
                >
                  {entry.phase} · {entry.title}
                </span>
                <span className="text-xs text-ink-3">
                  {entry.state === "not_applicable"
                    ? "Annual cycles only"
                    : (guidance?.output ?? "")}
                </span>
                {current && total > 0 ? (
                  <span className="flex items-center gap-2">
                    {/* No tone: the colour system keeps progress and status apart,
                        and the count beside it already says how far along this
                        phase is. */}
                    <Bar value={(met / total) * 100} className="h-1.5 flex-1" />
                    <span className="text-xs font-semibold text-ink-3">
                      {met} of {total}
                    </span>
                  </span>
                ) : null}
              </span>
            </Link>
          );
        })}
      </CardBody>
    </Card>
  );
}
