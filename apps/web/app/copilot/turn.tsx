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
  Tooltip,
  useTranslations,
} from "@openokr/ui";
import {
  CalendarCheck,
  Circle,
  ClipboardCheck,
  Copy,
  FileText,
  Flag,
  Gauge,
  Rocket,
  RotateCcw,
  SquareCheck,
  Target,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ReadCountLine, StepLine, StepSummary } from "./step-line";

/** A thing the copilot named: what it is, and how to read it. */
export interface Source {
  readonly entityType: string;
  readonly entityId: string;
  readonly label: string;
}

/**
 * A citation on a recorded answer (plan 0.9.0 CP5). `n` is the `[n]` in the
 * prose, null on an answer recorded before numbers were kept. `href` is made
 * on the server through search's link builder, so the panel never builds one.
 */
export interface Citation extends Source {
  readonly n: number | null;
  readonly href: string | null;
}

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
  /** How many live reads the answer rests on, from the record of them (L3). */
  readonly readCount?: number;
  readonly createdAt: string;
}

/** The step a run says it is on (plan 0.8.1 W2). Core's `CopilotStep`. */
export type Step =
  | { readonly step: "searching" }
  | { readonly step: "found"; readonly count: number }
  | {
      readonly step: "reading";
      readonly tool: string;
      readonly subject?: string;
    }
  | { readonly step: "proposing" }
  | { readonly step: "writing" };

/**
 * A read in the reader's words. A read of one record names it, and the name
 * is the record's own title, which the product sent and the model did not
 * write. Written out tool by tool so each key is found by a search.
 */
function readingWords(
  step: Extract<Step, { step: "reading" }>,
  t: ReturnType<typeof useTranslations>["t"],
): string {
  if (step.subject) {
    return t("copilot.copilotPanel.step.reading.subject", {
      subject: step.subject,
    });
  }
  switch (step.tool) {
    case "goals.list":
      return t("copilot.copilotPanel.step.reading.goalsList");
    case "goals.read":
      return t("copilot.copilotPanel.step.reading.goalsRead");
    case "goals.checkIns":
      return t("copilot.copilotPanel.step.reading.goalsCheckIns");
    case "goals.keyResultHistory":
      return t("copilot.copilotPanel.step.reading.goalsKeyResultHistory");
    case "kpis.list":
      return t("copilot.copilotPanel.step.reading.kpisList");
    case "kpis.detail":
      return t("copilot.copilotPanel.step.reading.kpisDetail");
    case "initiatives.list":
      return t("copilot.copilotPanel.step.reading.initiativesList");
    case "initiatives.read":
      return t("copilot.copilotPanel.step.reading.initiativesRead");
    case "tasks.list":
      return t("copilot.copilotPanel.step.reading.tasksList");
    case "tasks.read":
      return t("copilot.copilotPanel.step.reading.tasksRead");
    case "blockers.board":
      return t("copilot.copilotPanel.step.reading.blockersBoard");
    case "review.inbox":
      return t("copilot.copilotPanel.step.reading.reviewInbox");
    default:
      return t("copilot.copilotPanel.step.reading.passages");
  }
}

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
    case "reading":
      return readingWords(step, t);
    case "proposing":
      return t("copilot.copilotPanel.step.proposing");
    case "writing":
      return t("copilot.copilotPanel.step.writing");
  }
}

/**
 * Where a passage kept with AI off lives. Those have no link from the server,
 * so the few types with a page that takes the id itself are linked here. A key
 * result is not one of them: its page takes a short id (plan 0.9.0 CP5).
 */
function localHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "goal":
      return `/goals/${entityId}`;
    case "kpi":
      return `/kpis/${entityId}`;
    case "initiative":
      return `/initiatives/${entityId}`;
    case "task":
      return `/tasks/${entityId}`;
    default:
      return null;
  }
}

/** How a source or citation reads: its own first line, or its type. */
const labelFor = (item: Source) =>
  item.label === "" ? item.entityType.replace("_", " ") : item.label;

/** One small icon per kind of thing, so a list of sources scans by type. */
function EntityIcon({ entityType }: { readonly entityType: string }) {
  const className = "size-3.5 shrink-0 text-ink-3";
  switch (entityType) {
    case "goal":
      return <Target className={className} aria-hidden="true" />;
    case "key_result":
      return <Flag className={className} aria-hidden="true" />;
    case "kpi":
      return <Gauge className={className} aria-hidden="true" />;
    case "initiative":
      return <Rocket className={className} aria-hidden="true" />;
    case "task":
      return <SquareCheck className={className} aria-hidden="true" />;
    case "check_in":
      return <ClipboardCheck className={className} aria-hidden="true" />;
    case "session":
      return <CalendarCheck className={className} aria-hidden="true" />;
    case "document":
      return <FileText className={className} aria-hidden="true" />;
    default:
      return <Circle className={className} aria-hidden="true" />;
  }
}

/** A source with the number the prose cites it by, as recorded. */
type Numbered = Citation & { readonly n: number };

const isNumbered = (item: Source | Citation): item is Numbered =>
  "n" in item && typeof item.n === "number";

function SourceList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly (Source | Citation)[];
}) {
  if (items.length === 0) {
    return null;
  }
  const numbered = items.filter(isNumbered).sort((a, b) => a.n - b.n);
  if (numbered.length > 0) {
    return (
      <div>
        <p className="text-xs text-ink-4">{title}</p>
        <ol className="mt-1 flex flex-col gap-1">
          {numbered.map((item) => (
            <li
              key={`${item.n}:${item.entityType}:${item.entityId}`}
              className="flex items-center gap-1.5 text-xs"
            >
              <span className="w-5 shrink-0 text-right tabular-nums text-ink-4">
                {item.n}.
              </span>
              <EntityIcon entityType={item.entityType} />
              {item.href ? (
                <Link href={item.href} className="text-ink-2 underline">
                  {labelFor(item)}
                </Link>
              ) : (
                <span className="text-ink-3">{labelFor(item)}</span>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs text-ink-4">{title}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((item) => {
          // A recorded answer from before numbers carries the server's link;
          // a passage kept with AI off has none, and falls back to the few
          // types the panel can link on its own.
          const href =
            "href" in item
              ? item.href
              : localHref(item.entityType, item.entityId);
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

/** The chip for `[n]` in the answer's prose, or null for a number nobody cites. */
function CitationChip({
  n,
  citations,
}: {
  readonly n: number;
  readonly citations: readonly Citation[];
}) {
  const { t } = useTranslations();
  const citation = citations.find((item) => item.n === n);
  if (!citation) {
    return null;
  }
  const label = labelFor(citation);
  const className =
    "mx-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-raised px-1 align-baseline text-[10px] leading-4 text-ink-2 tabular-nums";
  const name = t("copilot.copilotPanel.sourceLabel", { n, label });
  return (
    <Tooltip label={label}>
      {citation.href ? (
        <Link
          href={citation.href}
          aria-label={name}
          className={`${className} hover:bg-line`}
        >
          {n}
        </Link>
      ) : (
        <span aria-label={name} role="note" className={className}>
          {n}
        </span>
      )}
    </Tooltip>
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
  readCount = 0,
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
  /** The reads behind a recorded answer, for the line after a reload (L3). */
  readonly readCount?: number;
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
      ) : text !== "" && !arriving ? (
        <ReadCountLine count={readCount} />
      ) : null}
      {text === "" ? null : (
        // The subset of formatting the copilot writes, drawn as elements
        // and never as HTML, with no link from the model's text (plan
        // 0.8.1 CP4).
        <AnswerText
          text={text}
          className="max-w-[68ch] text-sm leading-relaxed text-ink"
          // Numbered chips only on a recorded answer whose citations carry
          // their numbers. While arriving, or on an older answer, the prose
          // stays as the model wrote it (plan 0.9.0 CP5).
          renderCitation={
            !arriving && citations.some((item) => item.n !== null)
              ? (n) => <CitationChip n={n} citations={citations} />
              : undefined
          }
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
