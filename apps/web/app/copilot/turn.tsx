"use client";

/**
 * One turn of a copilot conversation (plan 0.8.1 CP3, screen S-39).
 *
 * **One component for an answer arriving and the answer recorded.** The
 * arriving text was a full-width box and the recorded one a 46-character
 * bubble, and between the stream ending and the re-read landing the answer was
 * not on screen at all, so every answer jumped and blinked when it finished
 * (review F7). Both are drawn here, the same width in the same place, and the
 * panel swaps one for the other in a single render.
 *
 * The member's question is a bubble on the right. The copilot's answer is
 * prose across the panel under its face, the way current chat products set
 * them, because an answer is read and a question is only recognised.
 */
import {
  AgentFace,
  AnswerText,
  Button,
  Chip,
  CopyButton,
  useTranslations,
} from "@openokr/ui";
import { Copy, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { StepLine, StepSummary } from "./step-line";

export interface Citation {
  readonly entityType: string;
  readonly entityId: string;
  readonly label: string;
}

export type Source = Citation;

export interface Message {
  readonly id: string;
  readonly role: "member" | "assistant";
  readonly content: string;
  readonly citations: readonly Citation[];
  readonly stopped: boolean;
  /** A background run is still producing this answer (P4-T14b-b). */
  readonly running?: boolean;
  /** Why the run stopped early, in words. Null when it did not. */
  readonly haltedReason?: string | null;
  readonly createdAt: string;
}

/** The step a run says it is on (plan 0.8.1 W2). Core's `CopilotStep`. */
export type Step =
  | { readonly step: "searching" }
  | { readonly step: "found"; readonly count: number }
  | { readonly step: "proposing" }
  | { readonly step: "writing" };

/** A step in the reader's words, from the catalogue and never from a model. */
export function stepWords(
  step: Step,
  t: ReturnType<typeof useTranslations>["t"],
): string {
  switch (step.step) {
    case "searching":
      return t("copilot.copilotPanel.step.searching");
    case "found":
      return step.count === 0
        ? t("copilot.copilotPanel.step.foundNone")
        : step.count === 1
          ? t("copilot.copilotPanel.step.foundOne", { count: step.count })
          : t("copilot.copilotPanel.step.foundOther", { count: step.count });
    case "proposing":
      return t("copilot.copilotPanel.step.proposing");
    case "writing":
      return t("copilot.copilotPanel.step.writing");
  }
}

/**
 * Where a cited or retrieved thing lives.
 *
 * Only the types that have a page of their own are linked. Everything else is
 * named without a link, which is honest: a retro note has no address, and a link
 * to nowhere is worse than plain text.
 */
function hrefFor(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "goal":
      return `/goals/${entityId}`;
    case "kpi":
      return `/kpis/${entityId}`;
    default:
      return null;
  }
}

/** How a source or citation reads: its own first line, or its type. */
const labelFor = (item: Source) =>
  item.label === "" ? item.entityType.replace("_", " ") : item.label;

function SourceList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly Source[];
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="text-xs text-ink-4">{title}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => {
          const href = hrefFor(item.entityType, item.entityId);
          return (
            <li key={`${item.entityType}:${item.entityId}`} className="text-xs">
              {href ? (
                <Link href={href} className="text-ink-2 underline">
                  {labelFor(item)}
                </Link>
              ) : (
                <span className="text-ink-3">{labelFor(item)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The member's question: a bubble on the right, up to 80% of the panel. */
export function MemberTurn({ text }: { readonly text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-lg bg-raised px-3 py-2 text-sm text-ink">
        {text}
      </p>
    </div>
  );
}

/**
 * What arrived for a question and is not in the recorded thread (plan 0.8.1
 * CP8, review F1). With AI off the passages and the reason are the answer, and
 * nothing records them, so the re-read that follows every turn used to take
 * them off the screen.
 */
export interface Kept {
  readonly sources: readonly Source[];
  readonly notice: string | null;
}

/**
 * The copilot's answer: its face and name, the cards it made, the prose, and
 * what it rested on.
 *
 * Cards come first, because the card is made before the answer (plan 0.8.1
 * A2) and nothing should move when the words arrive under it.
 */
export function AssistantTurn({
  text,
  arriving,
  steps,
  haltedReason,
  stopped,
  citations,
  kept,
  cards,
  copyText = null,
  onRetry = null,
  retryDisabled = false,
  error = null,
}: {
  /** The recorded answer, or the words that have arrived so far. */
  readonly text: string;
  /** Words are still coming, here or in a background run being rejoined. */
  readonly arriving: boolean;
  /**
   * What the run did, in order, while it is known: live only, so null after
   * a reload (plan 0.8.1 W2-Q). The last one is what it is doing now.
   */
  readonly steps: readonly Step[] | null;
  readonly haltedReason: string | null;
  readonly stopped: boolean;
  readonly citations: readonly Citation[];
  /** The passages and reason kept for this question with AI off (CP8). */
  readonly kept: Kept | null;
  readonly cards: ReactNode;
  /** The finished answer, offered to Copy (plan 0.8.1 CP7). */
  readonly copyText?: string | null;
  /** Asks the same question again, on the last answer when it fell short. */
  readonly onRetry?: (() => void) | null;
  readonly retryDisabled?: boolean;
  /** What went wrong with this turn, said where it happened. */
  readonly error?: string | null;
}) {
  const { t } = useTranslations();
  return (
    <article aria-busy={arriving || undefined} className="flex flex-col gap-2">
      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        {/* The face moves while the answer is on its way, and rests when it
            is done. One moving face in a panel is enough, so the header's
            only plays a change once. */}
        <AgentFace
          mood={arriving ? "thinking" : "idle"}
          live={arriving}
          className="size-5"
        />
        {t("copilot.copilotPanel.copilot")}
      </p>
      {cards}
      {/* While no words have come: one line saying what it is doing, replaced
          in place (plan 0.8.1 CP9). Once they come, the steps fold into one
          quiet line above them. Neither is a live region: the panel's status
          line says the steps, at most one every two seconds. */}
      {arriving && text === "" ? (
        steps && steps.length > 0 ? (
          <StepLine steps={steps} />
        ) : (
          <p className="copilot-shimmer text-sm text-ink-3">
            {t("copilot.copilotPanel.stillWriting")}
          </p>
        )
      ) : null}
      {text !== "" && steps && steps.length > 0 ? (
        <StepSummary steps={steps} />
      ) : null}
      {text === "" ? null : (
        // The subset of formatting the copilot writes, drawn as elements
        // and never as HTML, with no link from the model's text (plan
        // 0.8.1 CP4).
        <AnswerText
          text={text}
          className="max-w-[68ch] text-sm leading-relaxed text-ink"
          // A caret after the last word while more may come (CP9).
          trailing={
            arriving ? (
              <span className="copilot-caret" aria-hidden="true" />
            ) : undefined
          }
        />
      )}
      {haltedReason ? (
        <p className="text-xs text-ink-3">{haltedReason}</p>
      ) : null}
      {stopped ? (
        <span>
          <Chip tone="warn">{t("copilot.copilotPanel.stopped")}</Chip>
        </span>
      ) : null}
      {arriving ? null : (
        <SourceList
          title={t("copilot.copilotPanel.sources")}
          items={citations}
        />
      )}
      {error ? (
        <p role="alert" className="text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
      {copyText || onRetry ? (
        <div className="flex items-center gap-1">
          {copyText ? (
            <CopyButton
              text={copyText}
              variant="ghost"
              size="sm"
              aria-label={t("copilot.copilotPanel.copyAnswer")}
              className="px-1.5 text-ink-3"
            >
              <Copy className="size-3.5" aria-hidden="true" />
              {t("copilot.copilotPanel.copy")}
            </CopyButton>
          ) : null}
          {onRetry ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={retryDisabled}
              onClick={onRetry}
              className="px-1.5 text-ink-3"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t("copilot.copilotPanel.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {kept ? (
        <div data-testid="copilot-kept" className="flex flex-col gap-2">
          {/* The reason, unless the recorded answer already says it. */}
          {kept.notice && kept.notice !== haltedReason ? (
            <p className="rounded-md bg-raised px-3 py-2 text-xs text-ink-3">
              {kept.notice}
            </p>
          ) : null}
          <SourceList
            title={t("copilot.copilotPanel.passagesThatMatch")}
            items={kept.sources}
          />
        </div>
      ) : null}
    </article>
  );
}
