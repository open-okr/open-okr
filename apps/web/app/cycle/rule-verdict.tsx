"use client";

import type { QualityStatus } from "@openokr/method";
import { Button, buttonVariants } from "@openokr/ui";
import Link from "next/link";
import { useState } from "react";

/**
 * One check's verdict, as a chip that opens into the rule card
 * (UIUX-PLAN.md §4 S-09, mockups `03-draft-coach` and `03b-rule-card`).
 *
 * The chip is what a writer sees while typing: a status dot, the check id and
 * its short title, and nothing else. Everything the mockup's card carries is
 * one click away rather than on screen at all times, because §4's own rule is
 * that warnings never block typing, and twenty-six expanded cards would block
 * it just as effectively as a modal.
 *
 * **The card shows the prompt and the reason, and they are different
 * sentences.** The prompt says what to do; the condition says what was seen.
 * A card with only the prompt makes a writer guess which part of their sentence
 * caused it.
 *
 * There is no invented "why it matters" line here, though the mockup draws one.
 * METHOD.md carries a prompt per condition and nothing else, and writing
 * twenty-six new explanations would be authoring practice rather than
 * implementing it. The mockup is reference; METHOD.md is the authority.
 */

export interface RuleVerdictView {
  readonly id: string;
  readonly title: string;
  readonly status: QualityStatus;
  readonly prompt: string;
  readonly condition: string;
  /** §4.6's pair, where the check has one. Most do not. */
  readonly examples: readonly {
    readonly weak: string;
    readonly strong: string;
    readonly why: string;
  }[];
  /** Which key results tripped it, by title. Empty for an objective check. */
  readonly offenders: readonly string[];
}

const TONE: Record<QualityStatus, string> = {
  pass: "border-ok/40 bg-ok-bg text-ok",
  warn: "border-warn/40 bg-warn-bg text-warn",
  fail: "border-bad/40 bg-bad-bg text-bad",
  todo: "border-line bg-raised text-ink-3",
};

/** `.vchip`: the verdict word, on its own tint. No border, so it needs no
 * class undoing one. */
const CHIP: Record<QualityStatus, string> = {
  pass: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  fail: "bg-bad-bg text-bad",
  todo: "bg-raised text-ink-3",
};

const BAND: Record<QualityStatus, string> = {
  pass: "bg-ok-bg",
  warn: "bg-warn-bg",
  fail: "bg-bad-bg",
  todo: "bg-raised",
};

const DOT: Record<QualityStatus, string> = {
  pass: "bg-ok",
  warn: "bg-warn",
  fail: "bg-bad",
  todo: "bg-ink-4",
};

const LABEL: Record<QualityStatus, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  todo: "TO DO",
};

export function RuleVerdict({
  verdict,
}: {
  readonly verdict: RuleVerdictView;
}) {
  const [open, setOpen] = useState(false);
  const label = `${verdict.id} · ${verdict.title}`;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className={`flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE[verdict.status]}`}
      >
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${DOT[verdict.status]}`}
        />
        {label}
      </button>

      {open ? (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-surface">
          {/* `.pop-h`: a tinted band the width of the card, not a title inside
           * the body. The band is what makes a fail card read as a fail
           * before anybody reads a word of it. */}
          <div
            className={`flex items-center gap-2.5 border-b border-line px-4 py-3 ${BAND[verdict.status]}`}
          >
            <span
              aria-hidden="true"
              className={`size-2.25 flex-none rounded-full ${DOT[verdict.status]}`}
            />
            <h3 className="flex-1 text-sm font-bold text-ink">{label}</h3>
            {/* `.vchip`: a real chip with its own tint. This was bare text
             * wearing the trigger chip's classes with `border-0
             * bg-transparent p-0` bolted on to undo them, which is a chip
             * fighting its own definition. */}
            <span
              className={`inline-flex h-5 flex-none items-center rounded-[5px] px-2 text-xs font-extrabold tracking-wide ${CHIP[verdict.status]}`}
            >
              {LABEL[verdict.status]}
            </span>
          </div>

          <div className="flex flex-col gap-2.5 p-4">
            <p className="text-sm text-ink-2">{verdict.prompt}</p>

            <p className="text-xs text-ink-3">
              <span className="font-semibold text-ink-2">What was seen. </span>
              {verdict.condition}
              {verdict.offenders.length > 0
                ? `: ${verdict.offenders.map((title) => `"${title}"`).join(", ")}`
                : ""}
            </p>

            {verdict.examples.map((pair) => (
              <div key={pair.weak} className="grid gap-3 sm:grid-cols-2">
                {/* `.exbox.w` and `.exbox.s`: a solid status border, not the
                 * 40 percent one that was here. At 40 percent the pair reads
                 * as two grey boxes, and the whole point of §4.6's pair is
                 * that you can tell which half is which at a glance. */}
                <div className="rounded-control border border-bad-dot bg-bad-bg p-3">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-bad">
                    Weak
                  </p>
                  <p className="text-sm font-medium leading-snug text-ink">
                    {pair.weak}
                  </p>
                </div>
                <div className="rounded-control border border-ok-dot bg-ok-bg p-3">
                  <p className="mb-1 text-[10px] font-extrabold uppercase tracking-wider text-ok">
                    Strong
                  </p>
                  <p className="text-sm font-medium leading-snug text-ink">
                    {pair.strong}
                  </p>
                </div>
                <p className="text-xs text-ink-3 sm:col-span-2">{pair.why}</p>
              </div>
            ))}

            <div className="flex items-center gap-2 pt-0.5">
              {/* Styled as the mockup's `.btn`, still an anchor, because it
               * navigates. A `<button>` here would take the link out of the
               * keyboard and screen-reader path §7 asks for, and would break
               * the end-to-end test that looks for it by its link role. */}
              <Link
                href={`/method/${verdict.id}`}
                className={buttonVariants({ variant: "default" })}
              >
                See the rule in METHOD
              </Link>
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => setOpen(false)}
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The §4 strength score, as the composer header reads it.
 *
 * The band boundaries are §11's `quality.strengthScoreBands`, passed in rather
 * than written here, so a workspace that has moved them sees its own colours.
 */
export function StrengthMeter({
  score,
  counts,
  bands,
}: {
  readonly score: number | null;
  readonly counts: {
    readonly pass: number;
    readonly warn: number;
    readonly fail: number;
    readonly todo: number;
  };
  readonly bands: { readonly red: number; readonly green: number };
}) {
  if (score === null) {
    return (
      <p className="text-xs text-ink-3">
        Nothing to score yet. The strength score arrives with the first check
        that can be answered.
      </p>
    );
  }
  const tone =
    score >= bands.green
      ? { text: "text-ok", bar: "bg-ok", word: "Green" }
      : score < bands.red
        ? { text: "text-bad", bar: "bg-bad", word: "Red" }
        : { text: "text-warn", bar: "bg-warn", word: "Amber" };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-bold tabular-nums ${tone.text}`}>
          {score}%
        </span>
        <span className={`text-xs font-semibold ${tone.text}`}>
          {tone.word}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full rounded-full ${tone.bar}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <p className="text-xs text-ink-3">
        OKR strength · {counts.pass} pass, {counts.warn} warn, {counts.fail}{" "}
        fail, {counts.todo} to do
      </p>
      <p className="text-xs text-ink-4">
        {bands.green}% and above is green. A warning never blocks typing; the
        six publish gates are what refuse a publication.
      </p>
    </div>
  );
}
