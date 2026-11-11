"use client";

/**
 * One change the copilot proposed, with what it would do and what may be done
 * about it (P4-T14b-a, screen S-39). Moved out of the panel when the cards
 * went into the turns that made them (plan 0.8.1 CP3).
 */
import { Button, Chip, useTranslations } from "@openokr/ui";
import { ArrowUpRight, Check, Undo2 } from "lucide-react";
import Link from "next/link";

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
  readonly onApply: () => void;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
  /** Why the last decision on this card was refused, on the card itself. */
  readonly error: string | null;
}) {
  const { t } = useTranslations();

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
          <div key={row.label} className="flex gap-2 text-xs">
            <dt className="w-20 flex-none text-ink-4">
              {PREVIEW_LABEL_KEYS[row.label]
                ? t(PREVIEW_LABEL_KEYS[row.label] as string)
                : row.label}
            </dt>
            <dd className="min-w-0 text-ink-2">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center gap-2">
        {proposal.status === "pending" ? (
          <>
            <Button
              variant="primary"
              disabled={busy}
              pending={busy && acting === `apply:${proposal.id}`}
              onClick={onApply}
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
