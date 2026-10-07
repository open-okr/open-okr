"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useActionState } from "react";
import { setNextActionAction } from "./blocker-actions.ts";
import type { Option } from "./blocker-panel.tsx";
import { NO_ERROR } from "./commitment-state.ts";

/**
 * §7.2 step 2, what dropped (P9-T19a-b).
 *
 * Every key result scored low in this session, and every one whose
 * confidence fell since the last session that scored it. A low one needs a
 * next action and its owner, due by the next check-in, before the session can
 * move on; a blocker is raised below only where something is actually
 * blocked, and its own next action answers the score too. The session used to
 * demand a blocker for every low score, which had a team inventing one.
 */

export interface LowScore {
  readonly keyResultId: string;
  readonly title: string;
  readonly confidence: number;
  readonly previousConfidence: number | null;
  readonly low: boolean;
  readonly dropped: boolean;
  readonly nextAction: {
    readonly text: string;
    readonly ownerName: string;
    readonly dueOn: string;
  } | null;
  readonly blocked: boolean;
}

function NextActionForm({
  sessionId,
  score,
  owners,
}: {
  readonly sessionId: string;
  readonly score: LowScore;
  readonly owners: readonly Option[];
}) {
  const { t } = useTranslations();
  const [state, submit, pending] = useActionState(
    setNextActionAction,
    NO_ERROR,
  );
  return (
    <form
      action={submit}
      aria-busy={pending}
      aria-label={t("session.detail.nextActions.nextActionFor", {
        title: score.title,
      })}
      className="flex flex-col gap-1.5"
    >
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="keyResultId" value={score.keyResultId} />
      <div className="flex flex-wrap gap-2">
        <input
          name="nextAction"
          aria-label={t("session.detail.nextActions.theNextAction")}
          placeholder={t("session.detail.blockerPanel.theNextActionAnd")}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
        <select
          name="ownerId"
          defaultValue=""
          aria-label={t("session.detail.nextActions.whoOwnsIt")}
          className="w-48 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          <option value="">{t("session.detail.nextActions.whoOwnsIt")}</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.label}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("session.detail.nextActions.setIt")}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-xs text-bad">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function NextActionPanel({
  sessionId,
  scores,
  owners,
  canWrite,
}: {
  readonly sessionId: string;
  readonly scores: readonly LowScore[];
  readonly owners: readonly Option[];
  readonly canWrite: boolean;
}) {
  const { t } = useTranslations();
  const waiting = scores.filter(
    (score) => score.low && score.nextAction === null && !score.blocked,
  );

  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("session.detail.nextActions.whatDropped")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("session.detail.nextActions.everyLowScore")}
          </p>
        </div>
        <Chip tone={waiting.length > 0 ? "warn" : "ok"}>
          {waiting.length === 0
            ? t("session.detail.nextActions.allAnswered")
            : t("session.detail.nextActions.waiting", {
                count: waiting.length,
              })}
        </Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {scores.length === 0 ? (
          <p className="text-xs text-ink-3">
            {t("session.detail.nextActions.nothingDropped")}
          </p>
        ) : (
          scores.map((score) => (
            <div
              key={score.keyResultId}
              data-testid="low-score"
              className="flex flex-col gap-1.5 border-t border-line pt-2 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm text-ink">{score.title}</span>
                <Chip tone={score.low ? "bad" : "warn"}>
                  {score.confidence.toFixed(1)}
                </Chip>
                {score.dropped && score.previousConfidence !== null ? (
                  <span className="text-xs text-ink-3">
                    {t("session.detail.nextActions.fellFrom", {
                      from: score.previousConfidence.toFixed(1),
                    })}
                  </span>
                ) : null}
              </div>
              {score.nextAction ? (
                <p className="text-xs text-ink-2">
                  {score.nextAction.text}
                  <span className="ml-1.5 text-ink-3">
                    {t("session.detail.nextActions.ownerAndDue", {
                      owner: score.nextAction.ownerName,
                      date: score.nextAction.dueOn,
                    })}
                  </span>
                </p>
              ) : score.blocked ? (
                <p className="text-xs text-ink-3">
                  {t("session.detail.nextActions.blockedBelow")}
                </p>
              ) : canWrite ? (
                <NextActionForm
                  sessionId={sessionId}
                  score={score}
                  owners={owners}
                />
              ) : null}
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}
