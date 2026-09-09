"use client";

import { BLOCKER_TYPE_DEFINITIONS } from "@openokr/method";
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
  raiseBlockerAction,
  reassignBlockerAction,
  resolveBlockerAction,
} from "./blocker-actions.ts";
import { type CommitmentState, NO_ERROR } from "./commitment-state.ts";

/**
 * §7.2 step 2: what is low, and what is in the way (S-22, P6-G19b).
 *
 * **The weekly diagnose stage rendered nothing at all.** `sessions.createBlocker`,
 * `sessions.resolveBlocker` and `sessions.reassignBlocker` shipped at P4-T07c
 * and the stage that needs them had no panel, so the room could not raise a
 * blocker in the session that found it. The stage gate below it refuses to
 * advance while a low-confidence key result has no blocker, which made the
 * weekly ritual unfinishable from the browser whenever anything was going
 * badly.
 *
 * **The clock is §7.2's twenty-four hours and it is not configurable.** §7.2
 * states it in words as part of the ritual, which is why `packages/method`
 * holds it as a constant rather than a §11 entry, and why the age chip turns
 * on `overdue`, which the read already decided, rather than on a number
 * compared here.
 *
 * **The taxonomy comes from the canon.** §6.2's five types are
 * `BLOCKER_TYPE_DEFINITIONS`, so a type added to METHOD.md appears in this select with no
 * change here.
 */

export interface SessionBlocker {
  readonly id: string;
  readonly type: string;
  readonly keyResultTitle: string | null;
  readonly ownerName: string;
  readonly nextAction: string;
  readonly hoursOpen: number;
  readonly overdue: boolean;
  readonly resolved: boolean;
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

function OneBlocker({
  blocker,
  owners,
  canWrite,
}: {
  readonly blocker: SessionBlocker;
  readonly owners: readonly Option[];
  readonly canWrite: boolean;
}) {
  const { t } = useTranslations();

  const [resolveState, resolve, resolving] = useActionState(
    resolveBlockerAction,
    NO_ERROR,
  );
  const [moveState, reassign, moving] = useActionState(
    reassignBlockerAction,
    NO_ERROR,
  );

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <span className="min-w-0 text-sm text-ink">
          {blocker.keyResultTitle ?? "No key result named"}
          <span className="ml-1.5 text-xs text-ink-3">
            {blocker.type.replace(/_/g, " ")} · {blocker.ownerName}
          </span>
        </span>
        <Chip tone={blocker.resolved ? "ok" : blocker.overdue ? "bad" : "warn"}>
          {blocker.resolved
            ? "resolved"
            : `${Math.round(blocker.hoursOpen)}h open`}
        </Chip>
      </div>
      <p className="text-xs text-ink-2">{blocker.nextAction}</p>

      {blocker.resolved || !canWrite ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={resolve} aria-busy={resolving}>
            <input type="hidden" name="blockerId" value={blocker.id} />
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={resolving}
            >
              {resolving ? "Resolving…" : "Resolve"}
            </Button>
          </form>

          <form
            action={reassign}
            aria-busy={moving}
            className="flex items-center gap-1.5"
          >
            <input type="hidden" name="blockerId" value={blocker.id} />
            <select
              name="ownerId"
              defaultValue=""
              aria-label={`Reassign ${blocker.keyResultTitle ?? "this blocker"}`}
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
            >
              <option value="">
                {t("session.detail.blockerPanel.moveItTo")}
              </option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.label}
                </option>
              ))}
            </select>
            <Button type="submit" variant="ghost" size="sm" disabled={moving}>
              {t("common.reassign")}
            </Button>
          </form>
        </div>
      )}
      <Problem state={resolveState} />
      <Problem state={moveState} />
    </div>
  );
}

function Raise({
  sessionId,
  owners,
  keyResults,
}: {
  readonly sessionId: string;
  readonly owners: readonly Option[];
  readonly keyResults: readonly Option[];
}) {
  const { t } = useTranslations();

  const [state, submit, pending] = useActionState(raiseBlockerAction, NO_ERROR);
  return (
    <form action={submit} aria-busy={pending} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className="flex flex-wrap gap-2">
        <select
          name="keyResultId"
          defaultValue=""
          aria-label={t("common.keyResult2")}
          className="w-64 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          <option value="">
            {t("session.detail.blockerPanel.whichKeyResult")}
          </option>
          {keyResults.map((keyResult) => (
            <option key={keyResult.id} value={keyResult.id}>
              {keyResult.label}
            </option>
          ))}
        </select>
        <select
          name="type"
          defaultValue=""
          aria-label={t("session.detail.blockerPanel.blockerType")}
          className="w-48 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          <option value="">{t("session.detail.blockerPanel.whatKind")}</option>
          {BLOCKER_TYPE_DEFINITIONS.map((one) => (
            <option key={one.type} value={one.type}>
              {one.label}
            </option>
          ))}
        </select>
        <select
          name="ownerId"
          defaultValue=""
          aria-label={t("common.owner")}
          className="w-48 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          <option value="">
            {t("session.detail.blockerPanel.whoOwnsClearingIt")}
          </option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.label}
            </option>
          ))}
        </select>
      </div>
      <input
        name="nextAction"
        placeholder={t("session.detail.blockerPanel.theNextActionAnd")}
        className="w-full max-w-prose rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
      />
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={pending}
        className="self-start"
      >
        {pending ? "Raising…" : "Raise a blocker"}
      </Button>
      <Problem state={state} />
    </form>
  );
}

export function BlockerPanel({
  sessionId,
  blockers,
  owners,
  keyResults,
  canWrite,
}: {
  readonly sessionId: string;
  readonly blockers: readonly SessionBlocker[];
  readonly owners: readonly Option[];
  readonly keyResults: readonly Option[];
  readonly canWrite: boolean;
}) {
  const { t } = useTranslations();

  const open = blockers.filter((one) => !one.resolved);

  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("session.detail.blockerPanel.blockers")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("session.detail.blockerPanel.everyKeyResultBelow")}
          </p>
        </div>
        <Chip tone={open.length > 0 ? "warn" : "ok"}>
          {open.length === 0 ? "none open" : `${open.length} open`}
        </Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {blockers.length === 0 ? (
          <p className="text-xs text-ink-3">
            {t("session.detail.blockerPanel.nothingRaisedInThis")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {blockers.map((blocker) => (
              <OneBlocker
                key={blocker.id}
                blocker={blocker}
                owners={owners}
                canWrite={canWrite}
              />
            ))}
          </div>
        )}

        {canWrite ? (
          <Raise
            sessionId={sessionId}
            owners={owners}
            keyResults={keyResults}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}
