"use client";

/**
 * One change the copilot proposed, with what it would do and what may be done
 * about it (P4-T14b-a, screen S-39). Moved out of the panel when the cards
 * went into the turns that made them (plan 0.8.1 CP3).
 */
import { Button, Chip, TextInput, useTranslations } from "@openokr/ui";
import { ArrowUpRight, Check, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export interface Proposal {
  readonly id: string;
  readonly action: string;
  readonly preview: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly why: string;
  readonly status: "pending" | "applied" | "dismissed";
  readonly undone: boolean;
  readonly reversible: boolean;
  /**
   * The workspace asks why anything is added mid-cycle and this proposal gives
   * no reason, so the card asks for one and Apply waits for it (design §4.3).
   */
  readonly needsReason: boolean;
  /** When it was made, which places it in the turn whose question made it. */
  readonly createdAt: string;
  /** Where what it made lives, once applied and not undone (CP7). */
  readonly href: string | null;
}

/** What the link to the made thing says, by action (plan 0.8.1 CP7). */
const OPEN_KEYS: Readonly<Record<string, string>> = {
  "goals.create": "copilot.copilotPanel.open.objective",
  "goals.addKeyResult": "copilot.copilotPanel.open.keyResult",
  "initiatives.create": "copilot.copilotPanel.open.initiative",
  "tasks.create": "copilot.copilotPanel.open.task",
  "goals.update": "copilot.copilotPanel.open.objective",
  "tasks.move": "copilot.copilotPanel.open.task",
  "initiatives.update": "copilot.copilotPanel.open.initiative",
  "goals.publishDraftedCheckIn": "copilot.copilotPanel.open.objective",
  "kpis.record": "copilot.copilotPanel.open.kpi",
};

/**
 * What each proposable action is called on screen (completeness review M-09).
 *
 * The card printed the registry name, `goals.create`, which P8-G11d's rule
 * keeps out of the interface. With one action it was one string; with four it
 * is a reader wondering what `initiatives.create` means. An action without a
 * name here, which the catalogue in `packages/core` would have to gain first,
 * reads as a proposed change rather than as its identifier.
 */
const ACTION_NAME_KEYS: Readonly<Record<string, string>> = {
  "goals.create": "copilot.copilotPanel.actions.newObjective",
  "goals.addKeyResult": "copilot.copilotPanel.actions.newKeyResult",
  "initiatives.create": "copilot.copilotPanel.actions.newInitiative",
  "tasks.create": "copilot.copilotPanel.actions.newTask",
  "goals.update": "copilot.copilotPanel.actions.editObjective",
  "tasks.move": "copilot.copilotPanel.actions.moveTask",
  "initiatives.update": "copilot.copilotPanel.actions.changeInitiative",
  "goals.publishDraftedCheckIn": "common.checkIn",
  "kpis.record": "copilot.copilotPanel.actions.recordKpiValue",
};

/**
 * The preview's labels, as the reader's language.
 *
 * Core builds the preview in English words because it is stored with the
 * proposal and read back on any surface; the panel is where it meets a
 * reader. A label not listed here is shown as it was stored.
 */
const PREVIEW_LABEL_KEYS: Readonly<Record<string, string>> = {
  Objective: "copilot.copilotPanel.preview.objective",
  Description: "copilot.copilotPanel.preview.description",
  Level: "copilot.copilotPanel.preview.level",
  Space: "copilot.copilotPanel.preview.space",
  Cycle: "copilot.copilotPanel.preview.cycle",
  "Key result": "copilot.copilotPanel.preview.keyResult",
  Baseline: "copilot.copilotPanel.preview.baseline",
  Target: "copilot.copilotPanel.preview.target",
  Direction: "copilot.copilotPanel.preview.direction",
  Indicator: "copilot.copilotPanel.preview.indicator",
  Initiative: "copilot.copilotPanel.preview.initiative",
  Task: "copilot.copilotPanel.preview.task",
  Title: "copilot.copilotPanel.preview.title",
  Status: "copilot.copilotPanel.preview.status",
  Reason: "copilot.copilotPanel.preview.reason",
  Confidence: "common.confidence",
  Narrative: "checkIn.timeline.narrative",
  KPI: "kpis.grid.kpi",
  Period: "common.period",
  Value: "copilot.copilotPanel.preview.value",
  Remark: "copilot.copilotPanel.preview.remark",
};

/**
 * One proposal, with what it would do and what may be done about it.
 *
 * **The buttons are offered whether or not the reader may use them.** A member
 * who cannot create an objective sees Apply and gets the permission layer's own
 * refusal, which is the S-39 requirement and the opposite of hiding it. The one
 * thing that is not offered is an undo for an action with no reverse, because
 * that is a fact about the action rather than about the reader.
 */
export function ProposalCard({
  proposal,
  busy,
  acting,
  onApply,
  onDismiss,
  onUndo,
  error,
}: {
  readonly proposal: Proposal;
  readonly busy: boolean;
  /** The button that started the work in flight, so only that one spins. */
  readonly acting: string | null;
  /** With the person's reason, when the card asked for one. */
  readonly onApply: (reason?: string) => void;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
  /** Why the last decision on this card was refused, on the card itself. */
  readonly error: string | null;
}) {
  const { t } = useTranslations();
  const [reason, setReason] = useState("");
  const asksReason = proposal.status === "pending" && proposal.needsReason;
  const reasonMissing = asksReason && reason.trim() === "";

  return (
    <section
      aria-label={t("copilot.copilotPanel.proposedChange")}
      className="rounded-lg border border-line bg-surface p-3"
    >
      <header className="flex items-center gap-2">
        <Chip tone="agent">{t("common.ai")}</Chip>
        <span className="text-xs font-semibold text-ink-2">
          {t(
            ACTION_NAME_KEYS[proposal.action] ??
              "copilot.copilotPanel.proposedChange",
          )}
        </span>
        {proposal.status === "applied" ? (
          <Chip tone={proposal.undone ? "neutral" : "ok"}>
            {proposal.undone
              ? t("copilot.copilotPanel.undone")
              : t("copilot.copilotPanel.applied")}
          </Chip>
        ) : null}
        {proposal.status === "dismissed" ? (
          <Chip tone="neutral">{t("copilot.copilotPanel.dismissed")}</Chip>
        ) : null}
      </header>
      <p className="mt-2 text-xs text-ink-3">{proposal.why}</p>
      <dl className="mt-2 flex flex-col gap-1">
        {proposal.preview.map((row) => (
          // A check-in lists one row per key result, labelled with its title,
          // and two can share a title but not a title and a value.
          <div key={`${row.label}:${row.value}`} className="flex gap-2 text-xs">
            <dt className="w-20 flex-none break-words text-ink-4">
              {PREVIEW_LABEL_KEYS[row.label]
                ? t(PREVIEW_LABEL_KEYS[row.label] as string)
                : row.label}
            </dt>
            <dd className="min-w-0 text-ink-2">{row.value}</dd>
          </div>
        ))}
      </dl>
      {asksReason ? (
        // The same words and the same field the objective form uses for a
        // mid-cycle start: the workspace requires them, so Apply waits.
        <TextInput
          value={reason}
          label={t("midCycle.whyNowRequired")}
          hideLabel
          maxLength={500}
          placeholder={t("midCycle.whyNowPlaceholder")}
          disabled={busy}
          onChange={(event) => setReason(event.target.value)}
          className="mt-2 w-full min-w-0"
          inputClassName="px-2 text-xs"
        />
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        {proposal.status === "pending" ? (
          <>
            <Button
              variant="primary"
              disabled={busy || reasonMissing}
              pending={busy && acting === `apply:${proposal.id}`}
              onClick={() => onApply(asksReason ? reason.trim() : undefined)}
            >
              <Check className="size-4" />
              {t("common.apply")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              pending={busy && acting === `dismiss:${proposal.id}`}
              onClick={onDismiss}
            >
              {t("common.dismiss")}
            </Button>
          </>
        ) : null}
        {proposal.status === "applied" &&
        !proposal.undone &&
        proposal.reversible ? (
          <Button
            variant="ghost"
            disabled={busy}
            pending={busy && acting === `undo:${proposal.id}`}
            onClick={onUndo}
          >
            <Undo2 className="size-4" />
            {t("copilot.copilotPanel.undo")}
          </Button>
        ) : null}
        {proposal.status === "applied" && !proposal.reversible ? (
          <p className="text-xs text-ink-4">
            {t("copilot.copilotPanel.thisOneCannotBe")}
          </p>
        ) : null}
        {proposal.href ? (
          <Link
            href={proposal.href}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-text hover:underline"
          >
            {t(OPEN_KEYS[proposal.action] ?? "copilot.copilotPanel.open.made")}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </section>
  );
}
