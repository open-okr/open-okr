"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DateRangeInput,
  useTranslations,
} from "@openokr/ui";
import { useState, useTransition } from "react";
import { type ProfileResult, setLeaveAction } from "../actions.ts";

/**
 * A member's leave, on their profile (METHOD.md §7.4, P9-T19b-b).
 *
 * "A member marks their own leave, with a delegate." Every reader of the
 * profile sees it, because the people asking for a check-in need to know who
 * to ask instead; the member edits their own, and an administrator anybody's.
 * Each change is saved as it is made, the whole list at once.
 *
 * **No delegate is chosen for you.** The first name in a list is not somebody
 * who agreed to cover a fortnight of reviews, so the picker starts empty and
 * the button stays off until somebody is picked.
 */

export interface LeaveSpan {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly delegateId: string;
  readonly delegateName: string;
}

export function LeaveCard({
  memberId,
  isSelf,
  canEdit,
  leave,
  delegates,
}: {
  readonly memberId: string;
  readonly isSelf: boolean;
  readonly canEdit: boolean;
  readonly leave: readonly LeaveSpan[];
  /** Who may stand in: active people other than the member. */
  readonly delegates: readonly { readonly id: string; readonly name: string }[];
}) {
  const { t } = useTranslations();
  const [list, setList] = useState<readonly LeaveSpan[]>(leave);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [result, setResult] = useState<ProfileResult | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: readonly LeaveSpan[], after?: () => void) =>
    startTransition(async () => {
      const answer = await setLeaveAction(memberId, isSelf, next);
      setResult(answer);
      if (answer.ok) {
        setList([...next].sort((a, b) => a.startsOn.localeCompare(b.startsOn)));
        after?.();
      }
    });

  const backwards = startsOn !== "" && endsOn !== "" && endsOn < startsOn;

  return (
    <Card data-testid="member-leave">
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("people.detail.leave.leave")}
        </h2>
        <p className="text-xs text-ink-3">
          {t("people.detail.leave.whatLeaveDoes")}
        </p>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 text-sm">
        {list.length === 0 ? (
          <p className="text-ink-3">{t("people.detail.leave.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map((span) => (
              <li
                key={`${span.startsOn}:${span.endsOn}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-ink">
                  {t("people.detail.leave.span", {
                    startsOn: span.startsOn,
                    endsOn: span.endsOn,
                    delegate: span.delegateName,
                  })}
                </span>
                {canEdit ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    aria-label={t("people.detail.leave.remove", {
                      startsOn: span.startsOn,
                    })}
                    onClick={() => save(list.filter((one) => one !== span))}
                  >
                    {t("common.remove")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-line p-2.5">
            <DateRangeInput
              startLabel={t("people.detail.leave.from")}
              endLabel={t("people.detail.leave.to")}
              value={{ start: startsOn || null, end: endsOn || null }}
              onValueChange={(range) => {
                setStartsOn(range.start ?? "");
                setEndsOn(range.end ?? "");
              }}
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-3">
                {t("people.detail.leave.delegate")}
              </span>
              <select
                value={delegateId}
                onChange={(event) => setDelegateId(event.target.value)}
                className="w-56 rounded-md border border-line bg-bg px-2 py-1"
              >
                <option value="">
                  {t("people.detail.leave.chooseADelegate")}
                </option>
                {delegates.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              disabled={
                pending ||
                startsOn === "" ||
                endsOn === "" ||
                delegateId === "" ||
                backwards
              }
              onClick={() =>
                save(
                  [
                    ...list,
                    {
                      startsOn,
                      endsOn,
                      delegateId,
                      delegateName:
                        delegates.find((person) => person.id === delegateId)
                          ?.name ?? "",
                    },
                  ],
                  () => {
                    setStartsOn("");
                    setEndsOn("");
                    setDelegateId("");
                  },
                )
              }
            >
              {t("people.detail.leave.markTheLeave")}
            </Button>
          </div>
        ) : null}

        {/* An end before the start is said under the end date itself. */}
        {result && !result.ok ? (
          <p role="alert" className="text-xs text-bad">
            {result.message}
          </p>
        ) : result?.ok ? (
          <p
            role="status"
            data-testid="member-leave-saved"
            className="text-xs text-ok"
          >
            {result.message}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
