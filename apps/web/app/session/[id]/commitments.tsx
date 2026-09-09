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
import {
  closeCommitmentsAction,
  setCommitmentsAction,
} from "./commitment-actions.ts";
import { type CommitmentState, NO_ERROR } from "./commitment-state.ts";

/**
 * §7.2 step 3: close last week, set this week (S-22, P6-G19a).
 *
 * **Last week's commitments belong to last week's session and stay there.**
 * Nothing is copied forward. `sessions.carriedCommitments` reads the ones the
 * space has left open, so the record of who committed to what in which week
 * survives, which a rollover that rewrote rows would not.
 *
 * **The bounds are this workspace's, not the canon's.** §11 holds
 * `sessions.weeklyCommitmentBounds` and the workspace may move it, so the
 * numbers in the copy are passed in rather than written here.
 *
 * **Setting appends.** `sessions.setCommitments` inserts, so offering the
 * whole form again once a set exists would double it on a second press. What
 * is already set is shown, and one more row is offered beside it.
 */

export interface CarriedCommitment {
  readonly id: string;
  readonly text: string;
  readonly ownerName: string;
  readonly weekStart: string;
  readonly keyResultTitle: string | null;
}

export interface SetCommitment {
  readonly id: string;
  readonly text: string;
  readonly ownerName: string;
  readonly keyResultTitle: string | null;
}

export interface Option {
  readonly id: string;
  readonly label: string;
}

function Problem({ state }: { readonly state: CommitmentState }) {
  if (state.error === null) {
    return null;
  }
  return (
    <p role="alert" className="text-xs text-bad">
      {state.error}
    </p>
  );
}

function LastWeek({
  sessionId,
  carried,
}: {
  readonly sessionId: string;
  readonly carried: readonly CarriedCommitment[];
}) {
  const { t } = useTranslations();

  const [state, submit, pending] = useActionState(
    closeCommitmentsAction,
    NO_ERROR,
  );

  if (carried.length === 0) {
    return (
      <p className="text-xs text-ink-3">
        {t("session.detail.commitments.nothingIsCarriedIn")}
      </p>
    );
  }

  return (
    <form action={submit} aria-busy={pending} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      {carried.map((one) => (
        <div
          key={one.id}
          className="flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-2 text-sm first:border-0 first:pt-0"
        >
          <span className="min-w-0 text-ink">
            {one.text}
            <span className="ml-1.5 text-xs text-ink-3">
              {one.ownerName} {t("session.detail.commitments.weekOf")}{" "}
              {one.weekStart}
              {one.keyResultTitle ? ` · ${one.keyResultTitle}` : ""}
            </span>
          </span>
          <span className="flex flex-none items-center gap-3 text-xs text-ink-2">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="verdict"
                value={`${one.id}:yes`}
                className="size-3.5"
              />
              {t("session.detail.commitments.delivered")}
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="verdict"
                value={`${one.id}:no`}
                className="size-3.5"
              />
              {t("session.detail.commitments.notDelivered")}
            </label>
          </span>
        </div>
      ))}
      <p className="text-xs text-ink-4">
        {t("session.detail.commitments.leaveOneUnansweredAnd")}
      </p>
      <Button
        type="submit"
        variant="default"
        size="sm"
        disabled={pending}
        className="self-start"
      >
        {pending ? "Closing…" : "Close what was answered"}
      </Button>
      <Problem state={state} />
    </form>
  );
}

function ThisWeek({
  sessionId,
  already,
  owners,
  keyResults,
  low,
  high,
}: {
  readonly sessionId: string;
  readonly already: readonly SetCommitment[];
  readonly owners: readonly Option[];
  readonly keyResults: readonly Option[];
  readonly low: number;
  readonly high: number;
}) {
  const { t } = useTranslations();

  const [state, submit, pending] = useActionState(
    setCommitmentsAction,
    NO_ERROR,
  );
  // A fresh stage offers the whole set. Once something is recorded, one row at
  // a time, because the action appends.
  const rows = already.length === 0 ? high : 1;

  return (
    <div className="flex flex-col gap-2.5">
      {already.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {already.map((one) => (
            <li
              key={one.id}
              className="flex items-center justify-between gap-2.5 border-t border-line pt-1.5 text-sm first:border-0 first:pt-0"
            >
              <span className="min-w-0 text-ink">
                {one.text}
                <span className="ml-1.5 text-xs text-ink-3">
                  {one.ownerName}
                  {one.keyResultTitle ? ` · ${one.keyResultTitle}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <form action={submit} aria-busy={pending} className="flex flex-col gap-2">
        <input type="hidden" name="sessionId" value={sessionId} />
        {Array.from({ length: rows }, (_, index) => index).map((index) => (
          <div key={index} className="flex flex-wrap gap-2">
            <input
              name="text"
              placeholder={`What will move by next week (${index + 1})`}
              className="w-80 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
            <select
              name="ownerId"
              defaultValue=""
              aria-label={t("common.owner")}
              className="w-48 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">
                {t("session.detail.commitments.whoOwnsIt")}
              </option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
            <select
              name="keyResultId"
              defaultValue=""
              aria-label={t("common.keyResult2")}
              className="w-64 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">
                {t("session.detail.commitments.noKeyResult")}
              </option>
              {keyResults.map((keyResult) => (
                <option key={keyResult.id} value={keyResult.id}>
                  {keyResult.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={pending}
          className="self-start"
        >
          {pending
            ? "Saving…"
            : already.length === 0
              ? "Set this week's commitments"
              : "Add one more"}
        </Button>
        <Problem state={state} />
      </form>

      <p className="text-xs text-ink-3">
        {low} {t("common.to")} {high}{" "}
        {t("session.detail.commitments.aWeekFewerThan")} {low}{" "}
        {t("session.detail.commitments.andTheDigestStage")} {high}{" "}
        {t("session.detail.commitments.isAListNobody")}
      </p>
    </div>
  );
}

export function Commitments({
  sessionId,
  carried,
  already,
  owners,
  keyResults,
  low,
  high,
  canWrite,
}: {
  readonly sessionId: string;
  readonly carried: readonly CarriedCommitment[];
  readonly already: readonly SetCommitment[];
  readonly owners: readonly Option[];
  readonly keyResults: readonly Option[];
  readonly low: number;
  readonly high: number;
  readonly canWrite: boolean;
}) {
  const { t } = useTranslations();

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("common.lastWeek")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("session.detail.commitments.everyCommitmentThisSpace")}
            </p>
          </div>
          <Chip tone={carried.length > 0 ? "warn" : "ok"}>
            {carried.length === 0 ? "all closed" : `${carried.length} open`}
          </Chip>
        </CardHeader>
        <CardBody>
          {canWrite ? (
            <LastWeek sessionId={sessionId} carried={carried} />
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {carried.map((one) => (
                <li key={one.id}>
                  {one.text}
                  <span className="ml-1.5 text-xs text-ink-3">
                    {one.ownerName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("session.detail.commitments.thisWeek")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("session.detail.commitments.whatWillMoveBy")}
            </p>
          </div>
          <Chip tone={already.length >= low ? "ok" : "neutral"}>
            {already.length} {t("session.detail.commitments.set")}
          </Chip>
        </CardHeader>
        <CardBody>
          {canWrite ? (
            <ThisWeek
              sessionId={sessionId}
              already={already}
              owners={owners}
              keyResults={keyResults}
              low={low}
              high={high}
            />
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-ink-2">
              {already.length === 0 ? (
                <li className="text-xs text-ink-3">
                  {t("session.detail.commitments.nothingSetYetThe")}
                </li>
              ) : (
                already.map((one) => (
                  <li key={one.id}>
                    {one.text}
                    <span className="ml-1.5 text-xs text-ink-3">
                      {one.ownerName}
                    </span>
                  </li>
                ))
              )}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
