"use client";

import { type EntityOption, EntityPicker, useTranslations } from "@openokr/ui";
import { useEffect, useRef, useState } from "react";
import { reviewerIsChampion } from "../../lib/reviewer-is-champion.ts";

/**
 * The champion and reviewer pickers of the drafting step's new objective,
 * with the warning when they name the same person (plan 0.7.0, O3).
 *
 * okr-core-domain.md §4.1 warns and never refuses, because a one-person team
 * has nobody else. The step used to print the rule in a fixed line under the
 * form whether or not it applied; now the warning appears when it is true and
 * goes when it is not, and the objective is created either way.
 *
 * **The reviewer follows the practice** (METHOD.md §2.5, P9-T04): off asks for
 * none, so there is no picker; optional offers "No reviewer" after the
 * members; required offers members only, and the server refuses a goal
 * without one either way. It opens on nobody: a reviewer is somebody chosen.
 * The champion opens on whoever is drafting.
 *
 * Inside the form's row of fields, so the warning is placed last in the row on
 * a line of its own, under the button, and read straight after the reviewer.
 */
export function ChampionAndReviewer({
  people,
  defaultChampionId,
  reviewer,
  search,
}: {
  readonly people: readonly EntityOption[];
  readonly defaultChampionId: string | null;
  readonly reviewer: "off" | "optional" | "required";
  readonly search?: (text: string) => Promise<readonly EntityOption[]>;
}) {
  const { t } = useTranslations();
  const [championId, setChampionId] = useState(defaultChampionId);
  const [reviewerId, setReviewerId] = useState<string | null>(null);

  // React resets a form whose action succeeded, and the pickers go back to
  // where they opened. What is held here goes back with them, or the next
  // objective would be warned about the last one's reviewer.
  const status = useRef<HTMLDivElement>(null);
  const opened = useRef(defaultChampionId);
  opened.current = defaultChampionId;
  useEffect(() => {
    const form = status.current?.closest("form");
    if (!form) {
      return undefined;
    }
    const reset = () => {
      setChampionId(opened.current);
      setReviewerId(null);
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, []);

  const same = reviewer !== "off" && reviewerIsChampion(championId, reviewerId);

  return (
    <>
      <EntityPicker
        id="goal-champion"
        label={t("common.champion")}
        hideLabel
        name="championId"
        required
        defaultValue={defaultChampionId}
        onValueChange={setChampionId}
        options={people}
        {...(search ? { search } : {})}
        className="w-44"
        inputClassName="text-xs"
      />
      {reviewer === "off" ? null : (
        <EntityPicker
          id="goal-reviewer"
          label={t("common.reviewer")}
          hideLabel
          name="reviewerId"
          required={reviewer === "required"}
          defaultValue={null}
          onValueChange={setReviewerId}
          options={people}
          {...(reviewer === "optional"
            ? { noneLabel: t("cycle.drafting.noReviewer") }
            : {})}
          {...(search ? { search } : {})}
          className="w-44"
          inputClassName="text-xs"
        />
      )}
      {/* Always in the page, so a screen reader hears the warning arrive. */}
      <div
        ref={status}
        role="status"
        className="order-last basis-full empty:hidden"
      >
        {same ? (
          <p className="rounded-control bg-warn-bg px-2 py-1 text-xs text-warn">
            {t("cycle.drafting.reviewerIsChampion")}
          </p>
        ) : null}
      </div>
    </>
  );
}
