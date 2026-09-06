import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { CAPACITY_LABEL, CAPACITY_TONE } from "../initiatives/labels.ts";

/**
 * The align-and-commit capacity check (METHOD.md §5.5, UIUX-PLAN.md §4 S-10,
 * P5-T10b).
 *
 * **Two columns because there are two ways to fail one gate.** §5.5 asks for the
 * initiatives that will move each key result and a verdict on whether they fit.
 * A cycle can be refused because a measure itself is over-committed, or because
 * a project behind it is, and the two have different fixes: cut scope on the
 * measure, or cut the project. Gate five names whichever is red, and this is
 * where a facilitator goes to fix it.
 *
 * **A key result with no initiative is drawn, not hidden.** That is the state
 * §5.5 exists to find: a number nobody has said how they will move. It is not a
 * gate failure and the panel does not pretend it is, but a facilitator reading
 * this list should see it.
 */
export interface CapacityKeyResult {
  readonly id: string;
  readonly goalId: string;
  readonly goalTitle: string;
  readonly title: string;
  readonly capacity: "fits" | "tight" | "exceeds" | null;
  readonly initiativeIds: readonly string[];
}

export interface CapacityInitiative {
  readonly id: string;
  readonly title: string;
  readonly capacity: "fits" | "tight" | "exceeds" | null;
}

export function Capacity({
  keyResults,
  initiatives,
}: {
  readonly keyResults: readonly CapacityKeyResult[];
  readonly initiatives: readonly CapacityInitiative[];
}) {
  const byId = new Map(initiatives.map((one) => [one.id, one]));
  const overCommitted = initiatives.filter((one) => one.capacity === "exceeds");
  const unjudged = initiatives.filter((one) => one.capacity === null);

  return (
    <Card id="capacity-check">
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">Capacity</h2>
          <p className="text-xs text-ink-3">
            METHOD.md §5.5. Nothing may remain at "exceeds" when the set is
            published, and what was cut has to be recorded.
          </p>
        </div>
        <Link
          href="/initiatives"
          className="flex-none rounded-md border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
        >
          All initiatives
        </Link>
      </CardHeader>

      <CardBody className="flex flex-col gap-3">
        {overCommitted.length > 0 ? (
          <div
            className="rounded-md bg-bad-bg px-2.5 py-2 text-xs text-bad"
            data-testid="capacity-over"
          >
            <p className="font-semibold">
              {overCommitted.length === 1
                ? "One initiative is over capacity."
                : `${overCommitted.length} initiatives are over capacity.`}{" "}
              Gate five refuses this set until that changes.
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {overCommitted.map((one) => (
                <li key={one.id}>
                  <Link
                    href={`/initiatives/${one.id}`}
                    className="underline underline-offset-2"
                  >
                    {one.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {unjudged.length > 0 ? (
          <p className="rounded-md bg-raised px-2.5 py-1.5 text-xs text-ink-2">
            {unjudged.length === 1
              ? "One initiative has no capacity verdict yet."
              : `${unjudged.length} initiatives have no capacity verdict yet.`}{" "}
            §5.5: if the answer is "nothing was cut", capacity was not checked.
          </p>
        ) : null}

        {keyResults.length === 0 ? (
          <p className="rounded-md border border-line border-dashed px-3 py-4 text-center text-sm text-ink-3">
            This cycle has no key results to check capacity against yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {keyResults.map((keyResult) => (
              <li
                key={keyResult.id}
                className="flex flex-wrap items-start gap-2 py-2"
                data-testid="capacity-row"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate text-sm text-ink">
                    {keyResult.title}
                  </span>
                  <span className="truncate text-xs text-ink-3">
                    {keyResult.goalTitle}
                  </span>
                  {keyResult.initiativeIds.length === 0 ? (
                    <span className="text-xs text-ink-3">
                      No initiative recorded against it yet.
                    </span>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {keyResult.initiativeIds.map((initiativeId) => {
                        const initiative = byId.get(initiativeId);
                        if (!initiative) {
                          return null;
                        }
                        return (
                          <li key={initiativeId}>
                            <Link
                              href={`/initiatives/${initiativeId}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-brand"
                            >
                              {initiative.title}
                              <Chip
                                tone={
                                  CAPACITY_TONE[
                                    initiative.capacity ?? "unjudged"
                                  ]
                                }
                                dot
                              >
                                {
                                  CAPACITY_LABEL[
                                    initiative.capacity ?? "unjudged"
                                  ]
                                }
                              </Chip>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <Chip
                  tone={CAPACITY_TONE[keyResult.capacity ?? "unjudged"]}
                  dot
                >
                  {CAPACITY_LABEL[keyResult.capacity ?? "unjudged"]}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
