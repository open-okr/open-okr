"use client";

import { useTranslations } from "@openokr/ui";
import { useState } from "react";
import {
  CHANNEL_NAME_KEYS,
  TRIGGER_NAME_KEYS,
} from "../../lib/identifier-names.ts";
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
/**
 * The rule's name, which this card printed as its key (P8-G11d). Falls back to
 * the key, so a trigger with no name still labels the row; the coverage test
 * fails the build in that case.
 */
function ruleName(ruleKey: string, t: (key: string) => string): string {
  const named = TRIGGER_NAME_KEYS[ruleKey];
  return named === undefined ? ruleKey : t(named);
}

/** The channel it went out on, as a word. */
function channelName(channel: string, t: (key: string) => string): string {
  const named = CHANNEL_NAME_KEYS[channel];
  return named === undefined ? channel : t(named);
}

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
  const { t } = useTranslations();

  const [busy, setBusy] = useState<string | null>(null);

  if (nudges.length === 0) {
    return (
      <p className="text-xs text-ink-3">
        {t("review.nudgeProvenance.nothingHasNudgedYou")}
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
            <span className="rounded bg-raised px-1.5 py-0.5 text-[0.65rem] text-ink-2">
              {ruleName(nudge.ruleKey, t)}
            </span>
            {nudge.escalationStep > 1 ? (
              <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[0.65rem] font-semibold text-warn">
                {t("review.nudgeProvenance.escalationStep", {
                  escalationStep: nudge.escalationStep,
                })}
              </span>
            ) : null}
            <span className="text-xs text-ink-3">
              {t("review.nudgeProvenance.via", {
                channel: channelName(nudge.channel, t),
              })}
            </span>
          </div>

          {nudge.suppressedReason ? (
            <p className="text-xs text-ink-3">
              {t("review.nudgeProvenance.heldBackBecauseItIs", {
                suppressedReason:
                  REASON[nudge.suppressedReason] ?? nudge.suppressedReason,
              })}
            </p>
          ) : (
            <p className="text-xs text-ink-3">
              {t("common.sent3", {
                sentAt: nudge.sentAt
                  ? new Date(nudge.sentAt).toLocaleString()
                  : "",
              })}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/method/${nudge.ruleKey}`}
              className="text-xs font-semibold text-brand-text hover:underline"
            >
              {t("review.nudgeProvenance.seeTheRule")}
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
              {t("review.nudgeProvenance.snoozingStopsTheMessages")}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
