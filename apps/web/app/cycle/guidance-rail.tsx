import { guidanceForPhase, HORIZONS } from "@openokr/method";
import { Card, CardBody, CardHeader } from "@openokr/ui";

/**
 * The right rail (UIUX-PLAN.md §4 S-04: "the facilitator guidance for this
 * phase, the phase's key output, and the mode note for annual versus
 * quarterly").
 *
 * Every word here comes from `packages/method`. Nothing on this screen is
 * allowed to encourage, warn or advise in its own voice: METHOD.md is the only
 * source of OKR practice, and a rail that wrote its own tips would be a second
 * one.
 */
export function GuidanceRail({
  phase,
  mode,
}: {
  readonly phase: number;
  readonly mode: "annual" | "quarterly";
}) {
  const guidance = guidanceForPhase(phase);
  const horizon = HORIZONS[mode];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">Facilitator guidance</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        {guidance ? (
          <>
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-bold tracking-wide text-ink-3 uppercase">
                Key output
              </h3>
              <p className="border-brand-line border-l-2 pl-2.5 text-sm text-ink italic">
                {guidance.output}
              </p>
            </section>
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-bold tracking-wide text-ink-3 uppercase">
                Watch for
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-ink-2">
                {guidance.guidance.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-bold tracking-wide text-ink-3 uppercase">
            {mode} mode
          </h3>
          <p className="text-sm text-ink-2">{horizon.note}</p>
          <dl className="flex flex-col gap-1 text-xs text-ink-3">
            <div className="flex gap-1.5">
              <dt className="font-semibold">Runs</dt>
              <dd>{horizon.runs}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-semibold">Revisited</dt>
              <dd>{horizon.revisited}</dd>
            </div>
          </dl>
        </section>
      </CardBody>
    </Card>
  );
}
