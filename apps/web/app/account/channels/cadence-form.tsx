"use client";

import { Button } from "@openokr/ui";
import { useActionState } from "react";
import type { LinkResult } from "./link-state.ts";

/**
 * How often the product writes to you (S-36 member card, P6-G08).
 *
 * **The member half of TECHNICAL-PLAN §4.14 had no surface.** Per-reason
 * routing, the batching window, the daily summary and its time have been
 * stored in `notification_settings` since P2-T06, read by `notifyRecipients`
 * on every fan-out and by the Champion's daily run since P4-T05b, and there
 * was no way to see any of it or change it. `/account/channels` covered the
 * primary channel and quiet hours only. The gap audit recorded it under B-06.
 *
 * **Every field arrives with a value, so the form never blocks.** The row is
 * created lazily and the registry's defaults are the table's defaults, which
 * is what makes a member who has never opened this page already correctly
 * configured. The inputs are therefore pre-filled rather than empty with
 * placeholders.
 *
 * A client component because it is one form with a submit state, the same
 * shape `LinkForm` beside it takes.
 */
export function CadenceForm({
  action,
  settings,
  reasons,
  channels,
}: {
  readonly action: (
    previous: LinkResult | null,
    form: FormData,
  ) => Promise<LinkResult>;
  readonly settings: {
    readonly mentionImmediate: boolean;
    readonly batchWindowMinutes: number;
    readonly dailySummary: boolean;
    readonly dailySummaryTime: string;
    readonly routing: Readonly<Record<string, string>>;
  };
  /** Each reason and the words for it, in registry order. */
  readonly reasons: readonly { readonly id: string; readonly label: string }[];
  readonly channels: readonly { readonly id: string; readonly label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      aria-busy={pending}
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="mentionImmediate"
            defaultChecked={settings.mentionImmediate}
            className="size-4"
          />
          <span>
            Tell me the moment somebody mentions me
            <span className="ml-1.5 text-xs text-ink-3">
              Everything else waits for the window below.
            </span>
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          <span>Group everything else into one message every</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              name="batchWindowMinutes"
              min={1}
              max={1440}
              defaultValue={settings.batchWindowMinutes}
              className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm"
            />
            <span className="text-xs text-ink-3">
              minutes. A shorter window means more messages, not more news.
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input
            type="checkbox"
            name="dailySummary"
            defaultChecked={settings.dailySummary}
            className="size-4"
          />
          <span>Send me a summary each morning</span>
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink">
          <span>at</span>
          <span className="flex items-center gap-2">
            <input
              type="time"
              name="dailySummaryTime"
              defaultValue={settings.dailySummaryTime}
              className="w-28 rounded-md border border-line bg-surface px-2 py-1 text-sm"
            />
            <span className="text-xs text-ink-3">
              in your own timezone. The sweep runs hourly, so the hour is what
              it reads.
            </span>
          </span>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
        <legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-3">
          Where each kind goes
        </legend>
        <p className="text-xs text-ink-3">
          Leave one on "wherever I said" and it follows your primary channel
          above. The in-app inbox always gets a copy whatever you choose here.
        </p>
        {reasons.map((reason) => (
          <label
            key={reason.id}
            className="flex items-center justify-between gap-2.5 text-sm text-ink"
          >
            <span>{reason.label}</span>
            <select
              name={`routing.${reason.id}`}
              defaultValue={settings.routing[reason.id] ?? ""}
              className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
            >
              <option value="">wherever I said</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-2.5">
        <Button type="submit" variant="default" size="sm">
          Save
        </Button>
        {state ? (
          <p
            role="status"
            className={
              state.ok
                ? "text-xs text-ok"
                : "rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
            }
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
