"use client";

import type { QualityStatus } from "@openokr/method";
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
  pass: "border-ok/40 bg-ok-weak text-ok-text",
  warn: "border-warn/40 bg-warn-weak text-warn-text",
  fail: "border-bad/40 bg-bad-weak text-bad-text",
  todo: "border-line bg-raised text-ink-3",
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
        <div className="mt-1.5 flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">{label}</h3>
            <span
              className={`text-xs font-bold ${TONE[verdict.status]} border-0 bg-transparent p-0`}
            >
              {LABEL[verdict.status]}
            </span>
          </div>

          <p className="text-sm text-ink-2">{verdict.prompt}</p>

          <p className="text-xs text-ink-3">
            <span className="font-semibold text-ink-2">What was seen. </span>
            {verdict.condition}
            {verdict.offenders.length > 0
              ? `: ${verdict.offenders.map((title) => `"${title}"`).join(", ")}`
              : ""}
          </p>

          {verdict.examples.map((pair) => (
            <div key={pair.weak} className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-bad/40 bg-bad-weak p-2">
                <p className="text-[0.65rem] font-bold uppercase tracking-wide text-bad-text">
                  Weak
                </p>
                <p className="text-sm text-ink">{pair.weak}</p>
              </div>
              <div className="rounded-md border border-ok/40 bg-ok-weak p-2">
                <p className="text-[0.65rem] font-bold uppercase tracking-wide text-ok-text">
                  Strong
                </p>
                <p className="text-sm text-ink">{pair.strong}</p>
              </div>
              <p className="text-xs text-ink-3 sm:col-span-2">{pair.why}</p>
            </div>
          ))}

          <Link
            href={`/method/${verdict.id}`}
            className="w-fit text-xs font-semibold text-brand-text hover:underline"
          >
            See the rule in METHOD
          </Link>
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
      ? { text: "text-ok-text", bar: "bg-ok", word: "Green" }
      : score < bands.red
        ? { text: "text-bad-text", bar: "bg-bad", word: "Red" }
        : { text: "text-warn-text", bar: "bg-warn", word: "Amber" };

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
