import { callAction } from "@openokr/core";
import {
  Button,
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  Chip,
} from "@openokr/ui";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import { acknowledge } from "./actions.ts";

/**
 * Review, "what I owe" (UIUX-PLAN.md §4 S-02, P3-T08).
 *
 * The accountability surface, and the one screen in the product that is allowed
 * to be a list of chores. Everything on it is computed at read time by
 * `review.inbox`: there is no obligations table, so nothing here can be stale in
 * the way a stored copy would be.
 *
 * **It says what you owe. It does not say what happened.** That distinction is
 * S-03's, the notification inbox, and keeping them apart is why this page has no
 * unread state and no mark-as-read.
 *
 * Two parts of the mockup are deliberately absent, both because they need a
 * phase that has not landed. "Why you got nudged" needs a nudge to be about, and
 * nudges are P4-T05. "Your week" needs the blocker clock and the session streak,
 * which are P3-T09 and P4-T04. Drawing either with invented numbers would make
 * the screen look finished while telling somebody something untrue.
 */

const GROUPS = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Due today" },
  { id: "this_week", label: "This week" },
  { id: "upcoming", label: "Upcoming" },
] as const;

type Obligation = Awaited<
  ReturnType<typeof callAction<"review.inbox">>
>["obligations"][number];

export default async function ReviewPage() {
  const { session, workspace } = await requireWorkspace();
  const inbox = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "review.inbox",
    {},
  );

  return (
    <AppShellLayout>
      <div className="mx-auto flex max-w-3xl flex-col gap-4.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">What you owe</h1>
              <p className="text-xs text-ink-3">
                Computed on the server, overdue first. Notifications say what
                happened. This says what you owe.
              </p>
            </div>
            <div className="flex flex-none items-center gap-3.5">
              <Count label="Overdue" value={inbox.counts.overdue} urgent />
              <Count label="Today" value={inbox.counts.today} />
              <Count label="This week" value={inbox.counts.thisWeek} />
            </div>
          </CardHeader>
        </Card>

        {inbox.obligations.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-2">You are all caught up.</p>
              <p className="mt-1 text-xs text-ink-3">
                A row appears here when a goal you champion is due a check-in,
                or when a check-in you review is waiting on you.
              </p>
            </CardBody>
          </Card>
        ) : (
          GROUPS.map((group) => {
            const rows = inbox.obligations.filter(
              (item) => item.group === group.id,
            );
            if (rows.length === 0) {
              return null;
            }
            return (
              <section key={group.id} className="flex flex-col gap-1.5">
                <h2 className="flex items-center gap-2 px-0.5 text-xs font-bold uppercase tracking-wide text-ink-3">
                  {group.label}
                  <span className="rounded-full bg-raised px-1.5 py-0.5 text-xs font-semibold text-ink-3">
                    {rows.length}
                  </span>
                </h2>
                <div className="flex flex-col gap-1.5">
                  {rows.map((row) => (
                    <Row key={row.id} obligation={row} />
                  ))}
                </div>
              </section>
            );
          })
        )}

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Not here yet</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-1.5">
            <p className="text-xs text-ink-3">
              S-02 lists six sources of obligation. Two of them work. The rest
              are named here rather than left out, so this page cannot look
              complete while quietly failing to tell you about something you
              own.
            </p>
            <ul className="flex flex-col gap-1">
              {inbox.pending.map((source) => (
                <li
                  key={source.kind}
                  className="flex items-center justify-between gap-2.5 text-xs"
                >
                  <span className="text-ink-2">{source.label}</span>
                  <Chip tone="neutral">{source.task}</Chip>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}

function Count({
  label,
  value,
  urgent,
}: {
  readonly label: string;
  readonly value: number;
  readonly urgent?: boolean;
}) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-4">
        {label}
      </span>
      <span
        className={
          urgent && value > 0
            ? "text-lg font-bold text-bad"
            : "text-lg font-bold text-ink"
        }
      >
        {value}
      </span>
    </span>
  );
}

/**
 * One obligation.
 *
 * The action is a link where the work needs a form (a check-in is a composer)
 * and a button where it does not (an acknowledgement is one click and nothing
 * else). S-02 asks for "a one-click action that opens the composer inline"; the
 * composer itself lives at `/check-in`, already built at P3-T07, so this opens
 * that rather than growing a second one nobody would keep in step with the
 * first.
 */
function Row({ obligation }: { readonly obligation: Obligation }) {
  const overdue = obligation.group === "overdue";
  return (
    <Card>
      <CardBody className="flex items-start justify-between gap-3.5 py-2.5">
        <span
          aria-hidden="true"
          className={
            overdue
              ? "mt-0.5 h-9 w-1 flex-none rounded-full bg-bad"
              : "mt-0.5 h-9 w-1 flex-none rounded-full bg-line"
          }
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">
            {obligation.title}
          </span>
          <span className="text-xs text-ink-3">{obligation.meta}</span>
        </span>
        <span className="flex flex-none items-center gap-2.5">
          <span
            className={
              overdue
                ? "text-xs font-bold text-bad"
                : "text-xs font-semibold text-ink-3"
            }
          >
            {obligation.dueLabel}
          </span>
          {obligation.kind === "acknowledgement" && obligation.checkInId ? (
            <ActionForm action={acknowledge}>
              <input
                type="hidden"
                name="checkInId"
                value={obligation.checkInId}
              />
              <Button type="submit" variant="primary">
                {obligation.actionLabel}
              </Button>
            </ActionForm>
          ) : (
            // An anchor rather than a Button, because this navigates. `Button`
            // renders a `<button>` and only a `<button>`, and wrapping a link in
            // one would take the middle-click, the open-in-new-tab and the
            // status bar away from a row whose whole job is to be followed.
            <a
              href={obligation.href}
              className={buttonVariants({ variant: "primary" })}
            >
              {obligation.actionLabel}
            </a>
          )}
        </span>
      </CardBody>
    </Card>
  );
}
