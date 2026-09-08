import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { trigger } from "@openokr/method";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../lib/access.ts";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { markRead, mute, snooze } from "./actions.ts";
import { SNOOZE_CHOICES } from "./snooze-choices.ts";
import { REASON_LABELS, subjectLink, subjectName } from "./subject-link.ts";

/**
 * Inbox, "what happened" (UIUX-PLAN.md §4 S-03, P6-G07a).
 *
 * **The notification spine had no screen for nine tasks.** P2-T06 built
 * subscriptions, recipient resolution, batching, settings and five actions;
 * P2-T07 built the fan-out that calls them. Nothing in `apps/web` listed a
 * single row, and `notifications.list`, `markRead`, `snooze`,
 * `getSettings`, `updateSettings` and `subscriptions.toggle` all had no
 * caller anywhere. The gap audit of 7 September 2026 recorded it as B-06.
 *
 * **It says what happened. It does not say what you owe.** That is S-02's job
 * and the two are deliberately separate: this page has unread state and a
 * mark-as-read, Review has neither, and a snooze here never hides a review
 * obligation because the two lists are computed from different things
 * entirely.
 *
 * **Grouped by subject, newest group first**, which is §4's "grouped by entity
 * with reason chips and unread dots". The grouping is by the subject the row
 * carries, which is a column on the row since migration 0074: before that it
 * was recoverable only through a nullable activity join, and two of the three
 * producers wrote no activity id at all.
 *
 * **Every proactive message shows its rule** (§3). A nudge row carries the
 * trigger key and the condition the catalogue states in METHOD.md's own words,
 * so a reader can see why they were messaged rather than only that they were.
 *
 * **One pane, not two.** §4 describes a list on the left and a preview of the
 * target on the right. The preview is the target's own screen, and every row
 * links to it, so a second pane here would be a partial copy of nine other
 * pages that could disagree with them. The link is the preview.
 */

type Row = Awaited<ReturnType<typeof callAction<"notifications.list">>>[number];

const FILTERS = [
  { id: "", label: "Everything" },
  { id: "unread", label: "Unread" },
  ...Object.entries(REASON_LABELS).map(([id, label]) => ({ id, label })),
] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const { filter } = await searchParams;
  const active = FILTERS.some((one) => one.id === filter) ? (filter ?? "") : "";

  if (level < ACCESS_LEVELS.view) {
    // Not reachable by an active member, who holds edit on the workspace's own
    // context through workspace_standard. It is here for the member whose
    // access was narrowed while they had the page open, and because a screen
    // with no denied state is a screen that trusts the sidebar to hide it.
    return (
      <AppShellLayout>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              You do not have access to this workspace.
            </p>
            <p className="mt-1 text-xs text-ink-3">
              Ask a workspace administrator to restore it. Nothing was lost: the
              notifications are still here and will be listed when your access
              is.
            </p>
          </CardBody>
        </Card>
      </AppShellLayout>
    );
  }

  const rows = await callAction(context, "notifications.list", {
    ...(active === "unread" ? { unreadOnly: true } : {}),
    ...(active !== "" && active !== "unread"
      ? { reason: active as Row["reason"] }
      : {}),
  });

  // Grouped in the order the rows arrive, so the group holding the newest
  // notification is first. A map preserves insertion order, which is what
  // makes that true without a second sort.
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row.subjectType ?? ""}:${row.subjectId ?? ""}`;
    const held = groups.get(key);
    if (held) {
      held.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const unread = rows.filter((row) => row.readAt === null).length;

  return (
    <AppShellLayout>
      <div className="flex flex-col gap-4.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">What happened</h1>
              <p className="text-xs text-ink-3">
                Grouped by what it is about, newest first. Review says what you
                owe. This says what happened.
              </p>
            </div>
            <div className="flex flex-none items-center gap-3.5">
              <div className="flex flex-col items-end">
                <span className="text-lg font-bold tabular-nums text-ink">
                  {unread}
                </span>
                <span className="text-xs text-ink-3">Unread</span>
              </div>
            </div>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-1.5">
            {FILTERS.map((one) => (
              <Link
                key={one.id || "all"}
                href={one.id === "" ? "/inbox" : `/inbox?filter=${one.id}`}
                className={
                  one.id === active
                    ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
                    : "rounded-full bg-raised px-2.5 py-1 text-xs font-semibold text-ink-3 hover:text-ink"
                }
              >
                {one.label}
              </Link>
            ))}
          </CardBody>
        </Card>

        {rows.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-2">
                {active === ""
                  ? "Nothing new."
                  : "Nothing here under that filter."}
              </p>
              <p className="mt-1 text-xs text-ink-3">
                A row appears when somebody mentions you, when a check-in you
                review arrives, or when the Champion has a reminder for you.
                Watch a goal from its own page to hear about its check-ins.
              </p>
            </CardBody>
          </Card>
        ) : (
          /* A named region around the groups, so the list is addressable
             separately from the filter row above it. The filter chips carry
             the same words as the reason chips by design, which makes "is
             there a Joined row" unanswerable without this: the end-to-end
             spec asked exactly that and matched the filter link instead. A
             labelled region is the right answer for a screen reader too,
             which otherwise meets an unnamed run of sections. */
          <section aria-label="Notifications" className="flex flex-col gap-4.5">
            {[...groups.entries()].map(([key, held]) => {
              const first = held[0];
              if (!first) {
                return null;
              }
              const href = subjectLink(first.subjectType, first.subjectId);
              return (
                <section key={key} className="flex flex-col gap-1.5">
                  <h2 className="flex items-center gap-2 px-0.5 text-xs font-bold uppercase tracking-wide text-ink-3">
                    {href ? (
                      <Link href={href} className="hover:text-ink">
                        {subjectName(first.subjectType)}
                      </Link>
                    ) : (
                      subjectName(first.subjectType)
                    )}
                    <span className="rounded-full bg-raised px-1.5 py-0.5 text-xs font-semibold text-ink-3">
                      {held.length}
                    </span>
                    {first.watching ? (
                      <ActionForm action={mute}>
                        <input
                          type="hidden"
                          name="subjectType"
                          value={first.subjectType ?? ""}
                        />
                        <input
                          type="hidden"
                          name="subjectId"
                          value={first.subjectId ?? ""}
                        />
                        <input type="hidden" name="subscribe" value="false" />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="h-5 px-1.5 text-xs font-semibold normal-case"
                        >
                          Mute
                        </Button>
                      </ActionForm>
                    ) : null}
                  </h2>
                  <div className="flex flex-col gap-1.5">
                    {held.map((row) => (
                      <NotificationRow key={row.id} row={row} href={href} />
                    ))}
                  </div>
                </section>
              );
            })}
          </section>
        )}
      </div>
    </AppShellLayout>
  );
}

function reasonTone(reason: Row["reason"]): "info" | "warn" | "neutral" {
  if (reason === "mentioned" || reason === "review") {
    return "warn";
  }
  if (reason === "check_in") {
    return "info";
  }
  return "neutral";
}

function NotificationRow({
  row,
  href,
}: {
  readonly row: Row;
  readonly href: string | null;
}) {
  // The rule's own condition, in METHOD.md's words, for a nudge row. The
  // nudge's channel message is deliberately one generic line for every rule
  // (see `draftFor` in packages/core/src/nudges/deliver.ts), so this is where
  // the reader finds out what actually fired.
  const rule = row.ruleKey ? trigger(row.ruleKey) : undefined;
  const line =
    row.rendered ??
    (rule ? rule.fires : null) ??
    (row.ruleKey ? `Reminder: ${row.ruleKey}` : "Something happened here.");

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5">
      <span
        aria-hidden
        className={
          row.readAt === null
            ? "mt-1.5 size-2 flex-none rounded-full bg-brand"
            : "mt-1.5 size-2 flex-none rounded-full bg-transparent"
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={reasonTone(row.reason)}>
            {REASON_LABELS[row.reason] ?? row.reason}
          </Chip>
          {row.readAt === null ? <span className="sr-only">Unread</span> : null}
          {row.ruleKey ? <Chip tone="agent">{row.ruleKey}</Chip> : null}
          <span className="text-xs text-ink-3">
            {new Date(row.createdAt)
              .toISOString()
              .slice(0, 16)
              .replace("T", " ")}
          </span>
        </div>
        {href ? (
          <Link href={href} className="text-sm text-ink hover:underline">
            {line}
          </Link>
        ) : (
          <p className="text-sm text-ink">{line}</p>
        )}
      </div>
      <div className="flex flex-none items-center gap-1.5">
        {row.readAt === null ? (
          <ActionForm action={markRead}>
            <input type="hidden" name="notificationId" value={row.id} />
            <Button type="submit" variant="ghost" size="sm">
              Mark read
            </Button>
          </ActionForm>
        ) : null}
        {SNOOZE_CHOICES.map((choice) => (
          <ActionForm key={choice.minutes} action={snooze}>
            <input type="hidden" name="notificationId" value={row.id} />
            <input
              type="hidden"
              name="untilMinutes"
              value={String(choice.minutes)}
            />
            <Button type="submit" variant="ghost" size="sm">
              {choice.label}
            </Button>
          </ActionForm>
        ))}
      </div>
    </div>
  );
}
