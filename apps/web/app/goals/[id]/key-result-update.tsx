"use client";

import { Button, MetricInput, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addKeyResult } from "../editor-actions.ts";
import { updateKeyResult } from "./actions.ts";

type Status = "on_track" | "caution" | "off_track";

/**
 * A key result's value and confidence on S-14 (P9-T08b).
 *
 * The value is history, recorded as it always was. **Confidence is a
 * check-in**, because METHOD.md §3.2 puts it there: the slider this replaces
 * was ignored by its server action precisely so that confidence would never
 * change without a sentence. So a changed confidence asks for the line a
 * check-in needs and the status it carries, and is published as a check-in on
 * the objective, which also moves its next check-in on (§7.2).
 *
 * The status starts at what the last check-in said, because health follows
 * the latest status (§3.5) and a confidence that moved should not change it
 * unless the reader says so; with no check-in yet, the reader chooses.
 */
export function KeyResultUpdate({
  goalId,
  keyResult,
  lastStatus,
}: {
  readonly goalId: string;
  readonly keyResult: {
    readonly id: string;
    readonly title: string;
    readonly currentValue: number;
    readonly confidence: number | null;
    readonly unit: string | null;
    readonly baselineValue: number;
    readonly targetValue: number | null;
  };
  readonly lastStatus: Status | null;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const stored =
    keyResult.confidence === null
      ? ""
      : String(Math.round(keyResult.confidence * 10));
  // A number or nothing: emptied, the field records nothing rather than 0.
  const [value, setValue] = useState<number | null>(keyResult.currentValue);
  const [confidence, setConfidence] = useState(stored);
  const [status, setStatus] = useState<Status | "">(lastStatus ?? "");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const confidenceMoved = confidence.trim() !== "" && confidence !== stored;
  const valueMoved = value !== null && value !== keyResult.currentValue;

  const save = async () => {
    if (!valueMoved && !confidenceMoved) {
      return;
    }
    setSaving(true);
    const result = await updateKeyResult({
      goalId,
      keyResultId: keyResult.id,
      ...(valueMoved && value !== null ? { value } : {}),
      ...(confidenceMoved
        ? {
            confidence: Number(confidence) / 10,
            status: status === "" ? null : status,
            note,
          }
        : {}),
    });
    setSaving(false);
    if (result.error) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    setNote("");
    router.refresh();
  };

  return (
    <form
      className="flex flex-col items-end gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <span className="flex items-center gap-1">
        <MetricInput
          label={t("common.newValueFor4", { title: keyResult.title })}
          hideLabel
          value={value}
          onValueChange={setValue}
          unit={keyResult.unit}
          baseline={keyResult.baselineValue}
          target={keyResult.targetValue}
          inputClassName="h-auto w-32 px-1.5 py-0.5 text-xs"
        />
        <input
          type="number"
          min={0}
          max={10}
          step={1}
          aria-label={t("goals.detail.confidenceFor", {
            title: keyResult.title,
          })}
          value={confidence}
          onChange={(event) => setConfidence(event.target.value)}
          className="w-12 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right text-xs text-ink"
        />
        <span className="text-xs text-ink-4">{t("okrDrawer.outOfTen")}</span>
        <Button type="submit" size="sm" disabled={saving}>
          {t("common.save")}
        </Button>
      </span>
      {confidenceMoved ? (
        <span
          data-testid="confidence-check-in"
          className="flex flex-wrap items-center justify-end gap-1"
        >
          <select
            aria-label={t("goals.detail.statusFor", { title: keyResult.title })}
            value={status}
            onChange={(event) => setStatus(event.target.value as Status | "")}
            className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-2"
          >
            {lastStatus ? null : (
              <option value="">{t("okrDrawer.chooseStatus")}</option>
            )}
            <option value="on_track">{t("common.onTrack")}</option>
            <option value="caution">{t("common.caution")}</option>
            <option value="off_track">{t("common.offTrack")}</option>
          </select>
          <input
            aria-label={t("goals.detail.whyConfidenceMoved", {
              title: keyResult.title,
            })}
            value={note}
            placeholder={t("goals.detail.whyConfidenceMovedPlaceholder")}
            onChange={(event) => setNote(event.target.value)}
            className="w-64 rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink placeholder:text-ink-4"
          />
        </span>
      ) : null}
      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </form>
  );
}

/**
 * S-14's "+ Add key result" (P9-T08b): the list's draft row, on the page. Nothing
 * is written until a title is committed, and a refusal keeps what was typed.
 */
export function AddKeyResult({
  goalId,
  ownerId,
  dueOn,
}: {
  readonly goalId: string;
  readonly ownerId: string;
  readonly dueOn: string | null;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setOpen(false);
    setTitle("");
    setProblem(null);
  };

  const commit = async () => {
    const wanted = title.trim();
    if (wanted === "" || saving) {
      return;
    }
    setSaving(true);
    const created = await addKeyResult({
      goalId,
      title: wanted,
      ownerId,
      ...(dueOn ? { dueOn } : {}),
    });
    setSaving(false);
    if (created.error) {
      setProblem(created.error);
      return;
    }
    close();
    router.refresh();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 self-start text-xs font-semibold text-brand-text hover:underline"
      >
        <span
          aria-hidden="true"
          className="flex size-4 items-center justify-center rounded-control border border-dashed border-brand-line bg-brand-weak"
        >
          +
        </span>
        {t("goals.editor.addKeyResult")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          ref={(node) => node?.focus()}
          value={title}
          aria-label={t("goals.editor.addKeyResult")}
          placeholder={t("goals.editor.keyResultPlaceholder")}
          disabled={saving}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              close();
            }
          }}
          className="min-w-0 flex-1 rounded-control border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
        />
        <Button
          type="button"
          size="sm"
          disabled={saving || title.trim() === ""}
          onClick={() => void commit()}
        >
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" onClick={close}>
          {t("common.cancel")}
        </Button>
      </div>
      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
