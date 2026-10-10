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
import { setSpaceHolidays } from "../actions.ts";
import { NO_SPACE_ERROR, type SpaceWriteState } from "../write-state.ts";

/**
 * A space's holidays, on the space (METHOD.md §7.4, P9-T19b-a).
 *
 * "A space marks its holiday periods. No check-in is due in them, nobody is
 * nudged for them, the streak does not break." Each change is saved as it is
 * made, the whole list at once, because the write that stores it is also the
 * one that moves the goals due inside it: a list edited and left unsaved
 * would show a summer that nothing behind it knows about.
 *
 * Behind the same level as the space's settings. The action refuses on its
 * own; the card only avoids offering what will be refused.
 */

export interface SpaceHoliday {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly label: string | null;
}

export function SpaceHolidaysCard({
  spaceId,
  holidays,
  canManage,
}: {
  readonly spaceId: string;
  readonly holidays: readonly SpaceHoliday[];
  readonly canManage: boolean;
}) {
  const { t } = useTranslations();
  const [list, setList] = useState<readonly SpaceHoliday[]>(holidays);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [label, setLabel] = useState("");
  const [state, setState] = useState<SpaceWriteState>(NO_SPACE_ERROR);
  const [pending, startTransition] = useTransition();

  const save = (next: readonly SpaceHoliday[], after?: () => void) =>
    startTransition(async () => {
      const result = await setSpaceHolidays(spaceId, next);
      setState(result);
      if (result.error === null) {
        setList([...next].sort((a, b) => a.startsOn.localeCompare(b.startsOn)));
        after?.();
      }
    });

  const backwards = startsOn !== "" && endsOn !== "" && endsOn < startsOn;

  return (
    <Card data-testid="space-holidays">
      <CardHeader>
        <h2 className="font-semibold text-ink">
          {t("spaces.detail.holidays.holidays")}
        </h2>
        <p className="text-sm text-ink-3">
          {t("spaces.detail.holidays.whatAHolidayDoes")}
        </p>
      </CardHeader>
      <CardBody className="flex flex-col gap-3 text-sm">
        {list.length === 0 ? (
          <p className="text-ink-3">{t("spaces.detail.holidays.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map((span) => (
              <li
                key={`${span.startsOn}:${span.endsOn}`}
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-ink">
                  {t("spaces.detail.holidays.span", {
                    startsOn: span.startsOn,
                    endsOn: span.endsOn,
                  })}
                </span>
                {span.label ? (
                  <span className="text-xs text-ink-3">{span.label}</span>
                ) : null}
                {canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending}
                    aria-label={t("spaces.detail.holidays.remove", {
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

        {canManage ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-line p-2.5">
            <DateRangeInput
              startLabel={t("spaces.detail.holidays.from")}
              endLabel={t("spaces.detail.holidays.to")}
              value={{ start: startsOn || null, end: endsOn || null }}
              onValueChange={(range) => {
                setStartsOn(range.start ?? "");
                setEndsOn(range.end ?? "");
              }}
            />
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-3">
                {t("spaces.detail.holidays.label")}
              </span>
              <input
                value={label}
                maxLength={80}
                placeholder={t("spaces.detail.holidays.labelPlaceholder")}
                onChange={(event) => setLabel(event.target.value)}
                className="w-48 rounded-md border border-line bg-bg px-2 py-1"
              />
            </label>
            <Button
              type="button"
              disabled={
                pending || startsOn === "" || endsOn === "" || backwards
              }
              onClick={() =>
                save(
                  [
                    ...list,
                    {
                      startsOn,
                      endsOn,
                      label: label.trim() === "" ? null : label.trim(),
                    },
                  ],
                  () => {
                    setStartsOn("");
                    setEndsOn("");
                    setLabel("");
                  },
                )
              }
            >
              {t("spaces.detail.holidays.markTheHoliday")}
            </Button>
          </div>
        ) : null}

        {/* An end before the start is said under the end date itself. */}
        {state.error ? (
          <p role="alert" className="text-xs text-bad">
            {state.error}
          </p>
        ) : state.saved ? (
          <p
            role="status"
            data-testid="space-holidays-saved"
            className="text-xs text-ok"
          >
            {t("spaces.detail.holidays.saved")}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
