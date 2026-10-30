"use client";

import { BLOCKER_TYPE_DEFINITIONS } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EntityPicker,
  SelectInput,
  TextInput,
  useTranslations,
} from "@openokr/ui";
import { useActionState } from "react";
import { peopleOptions } from "../../lib/entity-options.ts";
import { NO_ERROR } from "../cycle/write-state.ts";
import { raiseBlockerFromCheckIn } from "./actions.ts";

/**
 * Something in the way, said at check-in time (OKRGoal UX review, H11).
 *
 * The session room was the only screen that could raise a blocker, so an
 * owner with a blocker on a Wednesday waited for the meeting. The fields and
 * the taxonomy are the session's: §7.3's types come from the canon, and the
 * clock is the goal's next due date, which `blockers.raise` sets.
 */
export function RaiseBlocker({
  keyResults,
  owners,
}: {
  readonly keyResults: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly owners: readonly { readonly id: string; readonly label: string }[];
}) {
  const { t } = useTranslations();
  const [state, submit, pending] = useActionState(
    raiseBlockerFromCheckIn,
    NO_ERROR,
  );

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-0.5">
        <h2 className="text-sm font-bold text-ink">
          {t("checkIn.blocker.heading")}
        </h2>
        <p className="text-xs text-ink-3">{t("checkIn.blocker.hint")}</p>
      </CardHeader>
      <CardBody>
        <form
          action={submit}
          aria-busy={pending}
          className="flex flex-col gap-2"
        >
          <div className="flex flex-wrap gap-2">
            <EntityPicker
              label={t("common.keyResult")}
              hideLabel
              name="keyResultId"
              placeholder={t("session.detail.blockerPanel.whichKeyResult")}
              options={keyResults.map((keyResult) => ({
                id: keyResult.id,
                label: keyResult.label,
              }))}
              className="w-64"
            />
            <SelectInput
              label={t("session.detail.blockerPanel.blockerType")}
              hideLabel
              name="type"
              defaultValue=""
              className="w-48"
            >
              <option value="">
                {t("session.detail.blockerPanel.whatKind")}
              </option>
              {BLOCKER_TYPE_DEFINITIONS.map((one) => (
                <option key={one.type} value={one.type}>
                  {one.label}
                </option>
              ))}
            </SelectInput>
            <EntityPicker
              label={t("common.owner")}
              hideLabel
              name="ownerId"
              placeholder={t("session.detail.blockerPanel.whoOwnsClearingIt")}
              options={peopleOptions(owners)}
              className="w-48"
            />
          </div>
          <TextInput
            label={t("session.detail.blockerPanel.theNextActionAnd")}
            hideLabel
            name="nextAction"
            placeholder={t("session.detail.blockerPanel.theNextActionAnd")}
            maxLength={500}
            className="w-full max-w-prose"
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending}
            className="self-start"
          >
            {pending
              ? t("session.detail.blockerPanel.raising")
              : t("session.detail.blockerPanel.raiseABlocker")}
          </Button>
          {state.error !== null ? (
            <p role="alert" className="text-xs text-bad">
              {state.error}
            </p>
          ) : state.notice ? (
            <p role="status" className="text-xs text-ok">
              {state.notice}
            </p>
          ) : null}
        </form>
      </CardBody>
    </Card>
  );
}
