"use client";

/**
 * The monthly review (UIUX-PLAN.md S-23, METHOD.md §7.5, P4-T09).
 *
 * Four panels, one per line of §7.5's table: a trend per objective, the
 * dependency and risk log, the resource or priority shifts, and the decisions.
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
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import {
  recordDecisionAction,
  setShiftsAction,
  setTrendAction,
} from "./actions";

const TRENDS = [
  { value: "improving", label: "Improving" },
  { value: "flat", label: "Flat" },
  { value: "declining", label: "Declining" },
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
  dependencies,
  decisions,
  subjects,
  canEdit,
}: {
  readonly sessionId: string;
  readonly shifts: string | null;
  readonly trends: readonly MonthlyTrend[];
  readonly untrended: readonly MonthlyUntrended[];
  readonly dependencies: readonly MonthlyDependency[];
  readonly decisions: readonly MonthlyDecision[];
  readonly subjects: readonly DecisionSubject[];
  readonly canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [shiftsDraft, setShiftsDraft] = useState(shifts ?? "");
  const [decisionText, setDecisionText] = useState("");
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
            error instanceof Error ? error.message : "That did not save.",
          );
        }
      });
    },
    [router],
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
        <CardHeader>Trend per objective</CardHeader>
        <CardBody className="flex flex-col gap-3">
          {objectives.length === 0 ? (
            <p className="text-sm text-ink-3">
              No objectives in this space and cycle, so there is no trend to
              record.
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
                      {option.label}
                    </Button>
                  ))}
                  {entry ? null : (
                    <span className="self-center text-xs text-ink-4">
                      Not recorded yet
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Dependency and risk log</CardHeader>
        <CardBody className="flex flex-col gap-2">
          {dependencies.length === 0 ? (
            <p className="text-sm text-ink-3">
              Nothing in the register for this space and cycle. Dependencies are
              added on the key result, not here, so this reads the one list
              rather than starting a second.
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
                      {dependency.confirmed ? "confirmed" : "unconfirmed"}
                    </Chip>
                    {dependency.confirmed || dependency.riskOwnerId ? null : (
                      // §5.4: unconfirmed and unowned is what holds publish
                      // gate 4 red, so the screen names it rather than leaving
                      // a reader to work out why the gate will not open.
                      <Chip tone="bad">no risk owner</Chip>
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
        <CardHeader>Resource or priority shifts</CardHeader>
        <CardBody className="flex flex-col gap-2">
          <textarea
            className="min-h-24 w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
            value={shiftsDraft}
            disabled={!canEdit}
            aria-label="Resource or priority shifts"
            placeholder="What moved, and why"
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
                Save the note
              </Button>
            </span>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Decisions</CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-xs text-ink-4">
            The record that survives the meeting. Every decision names the key
            result or the objective it affects, and appears on that goal's page
            afterwards.
          </p>

          {decisions.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing decided yet.</p>
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
                What it affects
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
                The decision
              </label>
              <textarea
                id="decision-text"
                className="min-h-20 w-full rounded-md border border-line bg-surface p-2 text-sm text-ink"
                value={decisionText}
                placeholder="What was decided"
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
                  Record the decision
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
