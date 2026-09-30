"use client";

import { Button, Chip, useTranslations } from "@openokr/ui";
import { useInstanceName } from "../../../lib/instance-name-context";
import type { AuditRow } from "./actions";

/**
 * The trail as a table (completeness review L-19, screen S-36).
 *
 * Drawn from state the panel holds rather than fetching for itself, so every
 * state it can be in can also be drawn in a test without a server: rows, none,
 * on the way, refused and failed.
 *
 * **What a row shows is what the export already hands over, and less.** When,
 * who and through which channel, the registry action, the target, and whether
 * the chainer has given the row its position yet. The payload is not here:
 * the action never sends it, and somebody who needs it takes the export, which
 * records that they did.
 */

/** What the table is drawing. */
export interface LogState {
  readonly rows: readonly AuditRow[];
  /** True when older rows match the same filter. */
  readonly more: boolean;
  /**
   * A page on its way. The rows already on screen stay until it lands, which
   * is UIUX-PLAN §4's "stale content stays visible while revalidating".
   */
  readonly busy: "replace" | "append" | null;
  /** Why the last page did not arrive, if it did not. */
  readonly failure: "denied" | { readonly message: string } | null;
}

export interface Member {
  readonly id: string;
  readonly name: string;
}

/**
 * A timestamp an auditor can read without guessing the format.
 *
 * `YYYY-MM-DD HH:mm:ss` in the reader's own time zone, which the column
 * header names. Built from numeric parts rather than a locale's own pattern,
 * because a month name differs between the ICU the server renders with and
 * the one the browser hydrates with, and a timestamp that changes as the page
 * wakes up is one nobody trusts.
 */
function stamper(timeZone: string): {
  readonly zone: string;
  readonly stamp: (iso: string) => string;
} {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
  } catch {
    // A zone this runtime does not know. UTC is at least a zone the header
    // can name truthfully.
    format = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" });
  }
  return {
    zone: format.resolvedOptions().timeZone,
    stamp: (iso) => {
      const part = Object.fromEntries(
        format.formatToParts(new Date(iso)).map((one) => [one.type, one.value]),
      );
      return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second}`;
    },
  };
}

/** The words for a channel the pipeline recorded. Unknown ones as written. */
const CHANNEL_NAME: Readonly<Record<string, string>> = {
  api: "admin.audit.log.channelApi",
  mcp: "admin.audit.log.channelMcp",
  email: "channels.email",
  slack: "channels.slack",
  teams: "channels.teams",
  telegram: "channels.telegram",
  whatsapp: "channels.whatsapp",
};

export function AuditLog({
  state,
  members,
  timeZone,
  filtered,
  onOlder,
  onRetry,
}: {
  readonly state: LogState;
  readonly members: readonly Member[];
  readonly timeZone: string;
  /** Whether any filter is applied, which changes what an empty list means. */
  readonly filtered: boolean;
  readonly onOlder: () => void;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslations();
  const instanceName = useInstanceName();
  const names = new Map(members.map((member) => [member.id, member.name]));
  const { zone, stamp } = stamper(timeZone);

  if (state.failure === "denied") {
    return (
      <p
        role="alert"
        data-testid="audit-log-denied"
        className="text-sm text-ink-3"
      >
        {t("admin.audit.log.denied")}
      </p>
    );
  }

  const who = (row: AuditRow): string => {
    const named = row.actorMemberId ? names.get(row.actorMemberId) : undefined;
    if (named) {
      return named;
    }
    if (row.actorKind === "operator") {
      return t("admin.audit.log.operator");
    }
    if (row.actorKind === "system") {
      return instanceName;
    }
    // A member the directory no longer lists: erased, or deleted. The row
    // still says a person acted, which is what the trail is for.
    return t("admin.audit.log.formerMember");
  };

  const channel = (value: string): string => {
    const key = CHANNEL_NAME[value];
    return t("admin.audit.log.via", { channel: key ? t(key) : value });
  };

  const failed = state.failure === null ? null : state.failure.message;

  return (
    <div className="flex flex-col gap-3" data-testid="audit-log-region">
      {failed === null ? null : (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2.5 rounded-md bg-bad-bg px-2.5 py-1.5"
        >
          <p className="text-sm font-medium text-bad">
            {t("admin.audit.log.failed", { reason: failed })}
          </p>
          <Button type="button" size="sm" onClick={onRetry}>
            {t("common.tryAgain")}
          </Button>
        </div>
      )}

      {state.rows.length === 0 ? (
        state.busy ? (
          <div
            aria-busy="true"
            data-testid="audit-log-loading"
            className="flex flex-col gap-2"
          >
            <div className="h-4 w-full animate-pulse rounded bg-raised" />
            <div className="h-4 w-full animate-pulse rounded bg-raised" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-raised" />
          </div>
        ) : failed === null ? (
          <p data-testid="audit-log-empty" className="text-sm text-ink-3">
            {filtered
              ? t("admin.audit.log.emptyFiltered")
              : t("admin.audit.log.empty")}
          </p>
        ) : null
      ) : (
        // Focusable and named, because the table is wider than a phone and
        // holds nothing else a keyboard can reach: without it the columns
        // past the edge cannot be scrolled to without a pointer (axe
        // scrollable-region-focusable, found by the s43 scan).
        <section
          className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand"
          aria-label={t("admin.audit.log.caption")}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container with nothing focusable inside must take focus itself, or a keyboard cannot scroll it (WCAG 2.1.1).
          tabIndex={0}
        >
          <table
            data-testid="audit-log"
            aria-busy={state.busy !== null}
            className={`w-full text-left text-xs ${state.busy === "replace" ? "opacity-60" : ""}`}
          >
            <caption className="sr-only">
              {t("admin.audit.log.caption")}
            </caption>
            <thead className="text-ink-3">
              <tr>
                <th scope="col" className="py-1 pr-3 font-semibold">
                  {t("admin.audit.log.when", { timeZone: zone })}
                </th>
                <th scope="col" className="py-1 pr-3 font-semibold">
                  {t("admin.audit.log.who")}
                </th>
                <th scope="col" className="py-1 pr-3 font-semibold">
                  {t("admin.audit.action")}
                </th>
                <th scope="col" className="py-1 pr-3 font-semibold">
                  {t("admin.audit.log.target")}
                </th>
                <th scope="col" className="py-1 font-semibold">
                  {t("admin.audit.log.chain")}
                </th>
              </tr>
            </thead>
            <tbody className="text-ink-2">
              {state.rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid="audit-row"
                  className="border-t border-line align-top"
                >
                  <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">
                    <time dateTime={row.at}>{stamp(row.at)}</time>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="block text-ink">{who(row)}</span>
                    {row.actorKind === "agent" ? (
                      <span className="block text-ink-4">
                        {t("admin.audit.log.kindAgent")}
                      </span>
                    ) : null}
                    {row.actorKind === "system" ? (
                      <span className="block text-ink-4">
                        {t("admin.audit.log.kindSystem")}
                      </span>
                    ) : null}
                    {row.channel ? (
                      <span className="block text-ink-4">
                        {channel(row.channel)}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-ink">
                    {row.action}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="block font-mono">{row.targetType}</span>
                    {row.targetId ? (
                      <span className="block font-mono break-all text-ink-4">
                        {row.targetId}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    {row.seq === null ? (
                      <Chip>{t("admin.audit.log.pending")}</Chip>
                    ) : (
                      t("admin.audit.log.position", { position: row.seq })
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        {state.more && state.rows.length > 0 ? (
          <Button
            type="button"
            size="sm"
            disabled={state.busy !== null}
            onClick={onOlder}
          >
            {t("admin.audit.log.older")}
          </Button>
        ) : null}
        {state.busy ? (
          <p role="status" className="text-xs text-ink-3">
            {t("admin.audit.log.loading")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
