"use client";

import { Button, useTranslations } from "@openokr/ui";
import { useState, useTransition } from "react";
import { setWatching } from "./watch-action.ts";

/**
 * "Watch this", on any subject that has a subscription list (S-03, P6-G07b).
 *
 * **`subscriptions.toggle` shipped at P2-T06 and no page ever called it.** It
 * could subscribe and unsubscribe, and nothing could answer "am I watching
 * this", so the only control anybody could have built was a button that
 * guessed its own state. `subscriptions.read` is the other half, added with
 * this, and it is why six pages can carry the same component.
 *
 * **The reason is shown, not just the state.** A member watching because they
 * were mentioned chose to be there; a member watching because they are the
 * reviewer did not. Both read "watching", and only one of them can safely turn
 * it off. §6.4's rule that a snooze never hides a review obligation is the
 * same idea one layer down: the control says what it is about to switch off.
 *
 * In `lib` rather than under a route, because six route segments render it.
 */

/**
 * §6.4's reasons, in the words a member would use about themselves. Each is
 * the whole sentence the control shows, and the three obligations below carry
 * the warning that turning the watch off does not remove the obligation.
 */
const REASON_WORDS: Record<string, string> = {
  invited: "watchControl.becauseInvited",
  joined: "watchControl.becauseJoined",
  mentioned: "watchControl.becauseMentioned",
  role: "watchControl.becauseRole",
  review: "watchControl.becauseReview",
  check_in: "watchControl.becauseCheckIn",
};

/** A reason a member should think twice about switching off. */
const OBLIGATION = new Set(["review", "role", "check_in"]);

export interface WatchState {
  readonly watching: boolean;
  readonly reason: string | null;
  readonly watchers: number;
  readonly everyone: boolean;
}

export function WatchControl({
  subjectType,
  subjectId,
  initial,
}: {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly initial: WatchState;
}) {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  const [state, setState] = useState<WatchState>(initial);
  const [problem, setProblem] = useState<string | null>(null);

  const reason = state.reason ? REASON_WORDS[state.reason] : null;
  const obligation = state.reason !== null && OBLIGATION.has(state.reason);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={state.watching ? "default" : "ai"}
          size="sm"
          disabled={pending}
          data-testid="watch-control"
          onClick={() => {
            setProblem(null);
            start(async () => {
              const next = await setWatching({
                subjectType,
                subjectId,
                subscribe: !state.watching,
              });
              if ("error" in next) {
                setProblem(next.error);
                return;
              }
              setState(next);
            });
          }}
        >
          {pending
            ? t("watchControl.saving")
            : state.watching
              ? t("watchControl.watching")
              : t("watchControl.watchThis")}
        </Button>
        {state.watchers > 0 ? (
          <span className="text-xs text-ink-3">
            {t("watchControl.watchers", { count: state.watchers })}
          </span>
        ) : null}
      </div>

      {state.everyone ? (
        <span className="text-xs text-ink-4">
          {t("watchControl.everybodyInTheSpace")}
        </span>
      ) : null}

      {state.watching && reason ? (
        <span
          className={obligation ? "text-xs text-warn" : "text-xs text-ink-4"}
        >
          {t(reason)}
        </span>
      ) : null}

      {problem ? (
        <span role="alert" className="text-xs text-bad">
          {problem}
        </span>
      ) : null}
    </div>
  );
}
