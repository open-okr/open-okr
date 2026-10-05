"use client";

import { Button, Chip, useTranslations } from "@openokr/ui";
import { useState } from "react";
import type { OkrDetail } from "../../lib/okr-tree/actions.ts";
import type { OkrGoal } from "../../lib/okr-tree/cache.ts";
import type { OkrHandle } from "../../lib/okr-tree/use-okr-tree.ts";

/**
 * Checking in from the drawer (P9-T08b, design §4.4).
 *
 * The composer's own fields, held in the drawer until Publish: a status, a
 * confidence for the objective, each key result's value and confidence, and
 * the narrative METHOD.md §7.2 asks for. **Nothing is written before
 * Publish**: `goals.publishDraftedCheckIn` opens the draft and publishes it
 * in one action, so a drawer closed half way leaves no draft behind.
 *
 * Confidence is shown out of ten, as the list shows it, and sent on §3.2's own
 * scale of nought to one. The status starts at what the last check-in said,
 * because health follows the latest status (§3.5) and a check-in that only
 * moved a number should not change it by default; with no check-in yet there
 * is nothing to carry forward, so the reader chooses.
 */

type Status = "on_track" | "caution" | "off_track";

const STATUSES: readonly { readonly value: Status; readonly label: string }[] =
  [
    { value: "on_track", label: "common.onTrack" },
    { value: "caution", label: "common.caution" },
    { value: "off_track", label: "common.offTrack" },
  ];

/** "7" for 0.7; empty where nothing is set. */
const outOfTen = (confidence: number | null | undefined): string =>
  confidence === null || confidence === undefined
    ? ""
    : String(Math.round(confidence * 10));

/** A whole number from nought to ten, or null for anything else. */
function tenths(text: string): number | null {
  if (text.trim() === "") {
    return null;
  }
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value <= 10
    ? value / 10
    : null;
}

export function CheckInTab({
  goal,
  detail,
  okr,
  onPublished,
}: {
  readonly goal: OkrGoal;
  readonly detail: OkrDetail;
  readonly okr: OkrHandle;
  readonly onPublished: () => void;
}) {
  const { t } = useTranslations();
  const last = detail.checkIns[0] ?? null;
  const [status, setStatus] = useState<Status | "">(last?.status ?? "");
  const [confidence, setConfidence] = useState(
    outOfTen(last?.confidence ?? 0.5),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      goal.keyResults.map((keyResult) => [
        keyResult.id,
        String(keyResult.currentValue),
      ]),
    ),
  );
  const [confidences, setConfidences] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      goal.keyResults.map((keyResult) => [
        keyResult.id,
        outOfTen(keyResult.confidence),
      ]),
    ),
  );
  const [narrative, setNarrative] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const publish = () => {
    if (status === "") {
      setProblem(t("okrDrawer.chooseStatus"));
      return;
    }
    const overall = tenths(confidence);
    if (overall === null) {
      setProblem(t("okrDrawer.confidenceOutOfTen"));
      return;
    }
    if (narrative.trim() === "") {
      setProblem(t("checkIn.actions.needsANarrative"));
      return;
    }
    // Only what moved: leaving a value alone and setting it to what it
    // already was are different statements, and the history says which.
    const changed = goal.keyResults.flatMap((keyResult) => {
      const value = Number(values[keyResult.id]);
      const next = tenths(confidences[keyResult.id] ?? "");
      const entry: {
        keyResultId: string;
        value?: number;
        confidence?: number;
      } = { keyResultId: keyResult.id };
      if (
        keyResult.kpiId === null &&
        values[keyResult.id]?.trim() !== "" &&
        Number.isFinite(value) &&
        value !== keyResult.currentValue
      ) {
        entry.value = value;
      }
      if (next !== null && next !== keyResult.confidence) {
        entry.confidence = next;
      }
      return Object.keys(entry).length > 1 ? [entry] : [];
    });
    setProblem(null);
    setSending(true);
    okr.mutate(
      {
        kind: "checkIn",
        id: goal.id,
        status,
        confidence: overall,
        narrative,
        values: changed,
      },
      {
        onSettled: () => setSending(false),
        onSuccess: (outcome) => {
          if (outcome.ok) {
            onPublished();
          }
        },
      },
    );
  };

  return (
    <form
      data-testid="drawer-check-in"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        publish();
      }}
    >
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="font-semibold text-ink-2">
            {t("okrDrawer.status")}
          </span>
          {/* Named on the control: a label wrapped round a select reads the
           * chosen option into the name as well. */}
          <select
            aria-label={t("okrDrawer.status")}
            value={status}
            onChange={(event) => setStatus(event.target.value as Status | "")}
            className="rounded-control border border-line bg-surface px-2 py-1 text-ink-2"
          >
            {last ? null : (
              <option value="">{t("okrDrawer.chooseStatus")}</option>
            )}
            {STATUSES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {t(entry.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="font-semibold text-ink-2">
            {t("okrDrawer.objectiveConfidence")}
          </span>
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            aria-label={t("okrDrawer.objectiveConfidence")}
            value={confidence}
            onChange={(event) => setConfidence(event.target.value)}
            className="w-14 rounded-control border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
          />
          <span className="text-ink-4">{t("okrDrawer.outOfTen")}</span>
        </label>
      </div>

      <ul className="flex flex-col gap-2">
        {goal.keyResults.map((keyResult) => (
          <li
            key={keyResult.id}
            className="flex flex-col gap-1 rounded-lg border border-line p-2"
          >
            <span className="text-xs font-semibold text-ink">
              {keyResult.title}
            </span>
            <span className="flex flex-wrap items-center gap-3 text-xs">
              {keyResult.kpiId ? (
                <Chip tone="info">{t("common.fromAKpi")}</Chip>
              ) : (
                <label className="flex items-center gap-1.5">
                  <span className="text-ink-3">{t("okrDrawer.value")}</span>
                  <input
                    type="number"
                    step="any"
                    aria-label={t("okrDrawer.checkInValueOf", {
                      title: keyResult.title,
                    })}
                    value={values[keyResult.id] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [keyResult.id]: event.target.value,
                      }))
                    }
                    className="w-24 rounded-control border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
                  />
                </label>
              )}
              <label className="flex items-center gap-1.5">
                <span className="text-ink-3">
                  {t("okrDrawer.confidenceLabel")}
                </span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  aria-label={t("okrDrawer.checkInConfidenceOf", {
                    title: keyResult.title,
                  })}
                  value={confidences[keyResult.id] ?? ""}
                  onChange={(event) =>
                    setConfidences((current) => ({
                      ...current,
                      [keyResult.id]: event.target.value,
                    }))
                  }
                  className="w-14 rounded-control border border-line bg-surface px-2 py-1 text-right tabular-nums text-ink"
                />
                <span className="text-ink-4">{t("okrDrawer.outOfTen")}</span>
              </label>
            </span>
          </li>
        ))}
      </ul>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-ink-2">
          {t("checkIn.composer.whatMovedWhatIs")}
        </span>
        <textarea
          rows={4}
          value={narrative}
          onChange={(event) => setNarrative(event.target.value)}
          placeholder={t("checkIn.composer.statusLivesInThe")}
          className="rounded-control border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
        />
      </label>

      {problem ? (
        <p role="alert" className="text-xs text-bad">
          {problem}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={sending}>
          {t("okrDrawer.publish")}
        </Button>
        <span className="text-xs text-ink-4">
          {t("okrDrawer.publishMoves")}
        </span>
      </div>
    </form>
  );
}
