"use client";

/**
 * Stage eight: the process-health survey (UIUX-PLAN.md S-24, METHOD.md §8.5,
 * P4-T11b).
 *
 * Five statements, one to five, anonymous. The room's averages and the response
 * count are live; the reader sees their own answers and nobody else's.
 *
 * **Anonymous means the read hands back no attribution.** The action stores a
 * salted hash where a member id would go, so this component has nothing to hide:
 * the averages arrive already pooled and the only per-person value in the payload
 * is the reader's own.
 *
 * **All five are answered together.** §8.6 builds the rhythm score out of
 * statements two and five, so a partial submission produces a diagnostic with a
 * hole in it, and the action refuses one.
 */
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { addActionAction, submitProcessHealthAction } from "./actions";

const SCORES = [1, 2, 3, 4, 5] as const;

export interface ProcessHealth {
  readonly statements: readonly {
    readonly statementKey: number;
    readonly statement: string;
    readonly average: number | null;
    readonly mine: number | null;
  }[];
  readonly responses: number;
  readonly rhythmScore: number | null;
  readonly lowest: {
    readonly statementKey: number;
    readonly statement: string;
  } | null;
  readonly submitted: boolean;
}

export function ProcessHealthPanel({
  sessionId,
  health,
  canAnswer,
  owners = [],
}: {
  readonly sessionId: string;
  readonly health: ProcessHealth;
  readonly canAnswer: boolean;
  /** Who can own the improvement action: the room (§8.5, P9-T20d). */
  readonly owners?: readonly { readonly id: string; readonly label: string }[];
}) {
  const { t } = useTranslations();
  const [actionOwner, setActionOwner] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [actionAdded, setActionAdded] = useState(false);

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<readonly (number | null)[]>(
    health.statements.map((entry) => entry.mine),
  );

  const submit = useCallback(() => {
    setProblem(null);
    if (chosen.some((value) => value === null)) {
      setProblem(t("session.detail.processHealth.allFiveTogether"));
      return;
    }
    startTransition(async () => {
      try {
        await submitProcessHealthAction(sessionId, chosen as number[]);
        router.refresh();
      } catch (error) {
        setProblem(
          error instanceof Error
            ? error.message
            : t("session.detail.thatDidNotSave"),
        );
      }
    });
  }, [chosen, router, sessionId, t]);

  return (
    <Card role="region" aria-labelledby="process-health-heading">
      <CardHeader>
        <span className="flex flex-wrap items-center gap-2">
          <h2
            id="process-health-heading"
            className="flex-1 text-sm font-bold text-ink"
          >
            {t("session.detail.processHealth.okrProcessHealth")}
          </h2>
          <Chip tone="neutral">
            {health.responses === 1
              ? t("session.detail.processHealth.responseCountOne", {
                  count: health.responses,
                })
              : t("session.detail.processHealth.responseCountOther", {
                  count: health.responses,
                })}
          </Chip>
          {health.submitted ? (
            <Chip tone="ok">{t("session.detail.processHealth.yoursIsIn")}</Chip>
          ) : null}
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-xs text-ink-4">
          {t("session.detail.processHealth.anonymousOneToFive")}
        </p>

        <ul className="flex flex-col gap-2">
          {health.statements.map((entry, index) => (
            <li
              key={entry.statementKey}
              className="flex flex-col gap-1.5 rounded-md border border-line p-2.5"
            >
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-semibold text-ink-3">
                  {entry.statementKey}
                </span>
                <span className="flex-1 text-sm text-ink">
                  {entry.statement}
                </span>
                {entry.average === null ? null : (
                  <Chip tone="neutral">{entry.average.toFixed(1)}</Chip>
                )}
              </span>
              {canAnswer ? (
                // A fieldset, the semantic element for a named group of
                // controls. Five identical 1-to-5 rows means five identical
                // button sets, so without a name on each group a screen reader
                // reads "1 2 3 4 5" five times with nothing to tell them apart.
                <fieldset
                  aria-label={t(
                    "session.detail.processHealth.scoreForStatement",
                    { statementKey: entry.statementKey },
                  )}
                  className="flex flex-wrap gap-1.5 border-0 p-0"
                >
                  {SCORES.map((score) => (
                    <Button
                      key={score}
                      type="button"
                      size="sm"
                      variant={chosen[index] === score ? "default" : "ghost"}
                      disabled={pending}
                      onClick={() =>
                        setChosen((was) =>
                          was.map((value, at) =>
                            at === index ? score : value,
                          ),
                        )
                      }
                    >
                      {score}
                    </Button>
                  ))}
                </fieldset>
              ) : null}
            </li>
          ))}
        </ul>

        {canAnswer ? (
          <span>
            <Button type="button" size="sm" disabled={pending} onClick={submit}>
              {health.submitted
                ? t("session.detail.processHealth.changeMyAnswers")
                : t("session.detail.processHealth.submitAnonymously")}
            </Button>
          </span>
        ) : null}

        {problem === null ? null : (
          <p className="text-sm text-bad">{problem}</p>
        )}

        {health.rhythmScore === null ? null : (
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-ink-3">
              {t("session.detail.processHealth.rhythmScore")}
            </span>
            <span className="text-lg font-bold tabular-nums text-ink">
              {health.rhythmScore.toFixed(1)}
            </span>
            <span className="text-xs text-ink-4">
              {/* Named rather than left as an unexplained number: §8.6 averages
                  statements two and five, and the diagnostic at P4-T11c reads
                  this against the cycle score. */}
              {t("session.detail.processHealth.theAverageOfStatements")}
            </span>
          </p>
        )}

        {health.lowest === null ? null : (
          // §8.5 (P9-T20d): "The lowest-scoring statement becomes an
          // improvement action for the next cycle, with an owner and a date."
          // Recorded with stage 11's actions, which already ask for both, so
          // it is in the minutes and carried like any other action.
          <div className="flex flex-col gap-2 rounded-md border border-line p-2.5">
            <p className="text-xs text-ink-3">
              {t("session.detail.processHealth.lowestBecomesAnAction", {
                statementKey: health.lowest.statementKey,
              })}
            </p>
            {canAnswer && !actionAdded ? (
              <span className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-3">
                    {t("session.detail.processHealth.whoOwnsIt")}
                  </span>
                  <select
                    value={actionOwner}
                    onChange={(event) => setActionOwner(event.target.value)}
                    className="rounded-md border border-line bg-surface p-1.5 text-sm text-ink"
                  >
                    <option value="">
                      {t("session.detail.processHealth.chooseAnOwner")}
                    </option>
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-ink-3">
                    {t("session.detail.processHealth.byWhen")}
                  </span>
                  <input
                    type="date"
                    value={actionDue}
                    onChange={(event) => setActionDue(event.target.value)}
                    className="rounded-md border border-line bg-surface p-1.5 text-sm text-ink"
                  />
                </label>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || actionOwner === "" || actionDue === ""}
                  onClick={() => {
                    const lowest = health.lowest;
                    if (!lowest) {
                      return;
                    }
                    setProblem(null);
                    startTransition(async () => {
                      try {
                        await addActionAction(
                          sessionId,
                          t("session.detail.processHealth.improve", {
                            statement: lowest.statement,
                          }),
                          actionOwner,
                          actionDue,
                        );
                        setActionAdded(true);
                        router.refresh();
                      } catch (error) {
                        setProblem(
                          error instanceof Error
                            ? error.message
                            : "That did not save.",
                        );
                      }
                    });
                  }}
                >
                  {t("session.detail.processHealth.makeItAnAction")}
                </Button>
              </span>
            ) : actionAdded ? (
              <span role="status" className="text-xs text-ok">
                {t("session.detail.processHealth.actionAdded")}
              </span>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
