import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { ActionForm } from "../cycle/action-form.tsx";
import { publishCheckIn } from "./actions.ts";
import { VotePanel, type VoteState } from "./vote-panel.tsx";

/**
 * The check-in composer (UIUX-PLAN.md §4 S-15, P3-T07).
 *
 * Status, a confidence dial, a required narrative, and every key result
 * pre-populated with the value it holds so the difference is visible before
 * anything is typed. Publishing is what advances the cadence, notifies subscribers
 * and creates the reviewer's obligation; all three happen in the action, not here.
 *
 * **The ✨ narrative draft is deliberately absent.** S-15 asks for one, and it
 * needs the AI provider, the prompt registry and the usage accounting, which are
 * Phase 4. A button that did nothing, or that invented a narrative locally, would
 * be worse than no button: the rule is that every AI affordance is hidden when the
 * provider is off, and today it is always off.
 */

export interface ComposerKeyResult {
  readonly id: string;
  readonly title: string;
  readonly unit: string | null;
  readonly direction: string;
  readonly baselineValue: number;
  readonly targetValue: number;
  readonly currentValue: number;
  readonly progressPct: number;
  readonly confidence: number | null;
  readonly kpiId: string | null;
}

export function Composer({
  checkInId,
  goalTitle,
  keyResults,
  nextGoalId,
}: {
  readonly checkInId: string;
  readonly goalTitle: string;
  readonly keyResults: readonly ComposerKeyResult[];
  /** The goal the walker moves to after this one, when there is one. */
  readonly nextGoalId: string | null;
}) {
  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">Check in</h2>
          <p className="text-xs text-ink-3">{goalTitle}</p>
        </div>
        <Chip tone="brand">draft</Chip>
      </CardHeader>
      <CardBody>
        <ActionForm action={publishCheckIn} className="flex flex-col gap-3.5">
          <input type="hidden" name="checkInId" value={checkInId} />

          <div className="flex flex-wrap items-center gap-2.5">
            <label
              className="text-xs font-semibold text-ink-2"
              htmlFor="status"
            >
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue="on_track"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-2"
            >
              <option value="on_track">On track</option>
              <option value="caution">Caution</option>
              <option value="off_track">Off track</option>
            </select>

            <label
              className="text-xs font-semibold text-ink-2"
              htmlFor="confidence"
            >
              Confidence
            </label>
            {/* A dial, as S-15 asks. 0.0 to 1.0 in tenths: METHOD.md §3.2 bands
                are read at 0.3, 0.4 and 0.7, so tenths are fine enough to land on
                every boundary and coarse enough to stop anybody pretending to
                two decimal places of certainty. */}
            <input
              id="confidence"
              name="confidence"
              type="range"
              min="0"
              max="1"
              step="0.1"
              defaultValue="0.5"
              className="w-40"
            />
            <span className="text-xs text-ink-4">0 to 1</span>
          </div>

          {keyResults.length === 0 ? (
            <p className="text-sm text-ink-3">
              This goal has no key results, so there are no values to report. A
              narrative on its own still records what happened.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {keyResults.map((keyResult) => (
                <li
                  key={keyResult.id}
                  className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm text-ink">
                        {keyResult.title}
                      </span>
                      <span className="text-xs text-ink-3">
                        {keyResult.direction} · {keyResult.baselineValue} to{" "}
                        {keyResult.targetValue}
                        {keyResult.unit ? ` ${keyResult.unit}` : ""} ·{" "}
                        {Math.round(keyResult.progressPct)}% now
                      </span>
                    </span>
                    <span className="flex flex-none items-center gap-1.5">
                      <span className="text-xs text-ink-4">
                        was {keyResult.currentValue}
                      </span>
                      {keyResult.kpiId ? (
                        <Chip tone="info">from a KPI</Chip>
                      ) : (
                        <>
                          <label
                            className="sr-only"
                            htmlFor={`value-${keyResult.id}`}
                          >
                            New value for {keyResult.title}
                          </label>
                          <input
                            id={`value-${keyResult.id}`}
                            name={`value:${keyResult.id}`}
                            type="number"
                            step="any"
                            defaultValue={keyResult.currentValue}
                            className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
                          />
                        </>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label
                      className="text-xs text-ink-3"
                      htmlFor={`confidence-${keyResult.id}`}
                    >
                      Confidence
                    </label>
                    <input
                      id={`confidence-${keyResult.id}`}
                      name={`confidence:${keyResult.id}`}
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      defaultValue={keyResult.confidence ?? 0.5}
                      className="w-32"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-semibold text-ink-2"
              htmlFor="narrative"
            >
              What moved, what is in the way, what happens next
            </label>
            <textarea
              id="narrative"
              name="narrative"
              rows={5}
              required
              placeholder="Status lives in the product. This is for the part a number cannot say."
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <Button type="submit" variant="primary">
              Publish
            </Button>
            <span className="text-xs text-ink-4">
              Publishing advances the cadence and asks the reviewer to
              acknowledge.
              {nextGoalId ? " The walker moves to your next due goal." : ""}
            </span>
          </div>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/** The private votes on this goal's key results, and the reveal (§6.6). */
export function Votes({
  votes,
  canReveal,
}: {
  readonly votes: readonly VoteState[];
  readonly canReveal: boolean;
}) {
  if (votes.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">Team confidence</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        <p className="text-xs text-ink-3">
          Private until the reveal. Before it you see the response count and
          your own number, and nothing else, because the numbers are not sent to
          the browser at all.
        </p>
        {votes.map((vote) => (
          <VotePanel key={vote.keyResultId} vote={vote} canReveal={canReveal} />
        ))}
      </CardBody>
    </Card>
  );
}
