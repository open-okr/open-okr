"use client";

import { useState } from "react";
import { snoozeNudge } from "./actions.ts";

/**
 * Why you were nudged, and what to do about it (P4-T04c, screen S-02).
 *
 * The mockup calls this "why you got nudged" and the review inbox has carried a
 * note saying it was waiting for nudges to exist. They do now.
 *
 * **A snooze silences the nudge and never the obligation.** The list above this
 * component does not move when somebody snoozes: it is what they owe, and
 * choosing not to be messaged about a thing is not the same as no longer owing
 * it. Saying so on the control itself is the only way somebody finds that out
 * before they are surprised by it.
 *
 * Every entry names its rule and links to it, because CLAUDE.md's hard rule is
 * that a proactive message cites a rule that resolves. A message a person cannot
 * trace back to a rule is the product having an opinion.
 */

export interface NudgeEntry {
  readonly id: string;
  readonly ruleKey: string;
  readonly escalationStep: number;
  readonly sentAt: string | null;
  readonly suppressedReason: string | null;
  readonly channel: string;
}

/** The five reasons, said the way a person would say them. */
const REASON: Record<string, string> = {
  dedup: "you already heard about this today",
  quiet_hours: "it arrived during your quiet hours",
  snooze: "you snoozed it",
  disabled: "an administrator turned this rule off",
  ceiling: "you had already had a week's worth",
};

export function NudgeProvenance({
  nudges,
}: {
  readonly nudges: readonly NudgeEntry[];
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (nudges.length === 0) {
    return (
      <p className="text-xs text-ink-3">
        Nothing has nudged you. Anything the product says to you appears here
        with the rule that caused it.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {nudges.map((nudge) => (
        <li
          key={nudge.id}
          className="flex flex-col gap-1 rounded-md border border-line p-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[0.65rem] text-ink-2">
              {nudge.ruleKey}
            </span>
            {nudge.escalationStep > 1 ? (
              <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[0.65rem] font-semibold text-warn">
                escalation step {nudge.escalationStep}
              </span>
            ) : null}
            <span className="text-xs text-ink-3">via {nudge.channel}</span>
          </div>

          {nudge.suppressedReason ? (
            <p className="text-xs text-ink-3">
              Held back, because{" "}
              {REASON[nudge.suppressedReason] ?? nudge.suppressedReason}. It is
              recorded here so the silence is answerable.
            </p>
          ) : (
            <p className="text-xs text-ink-3">
              Sent {nudge.sentAt ? new Date(nudge.sentAt).toLocaleString() : ""}
              .
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/method/${nudge.ruleKey}`}
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              See the rule
            </a>
            <button
              type="button"
              disabled={busy === nudge.id}
              onClick={async () => {
                setBusy(nudge.id);
                try {
                  const until = new Date();
                  until.setUTCDate(until.getUTCDate() + 7);
                  await snoozeNudge(nudge.id, until.toISOString());
                } finally {
                  setBusy(null);
                }
              }}
              className="rounded-md border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-brand"
            >
              {busy === nudge.id ? "Snoozing…" : "Snooze for a week"}
            </button>
            <span className="text-xs text-ink-4">
              Snoozing stops the messages. It does not clear what you owe, and
              the list above will not move.
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
