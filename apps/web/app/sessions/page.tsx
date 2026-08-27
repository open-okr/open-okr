import { callAction } from "@openokr/core";
import { buttonVariants, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";

/**
 * The session list (UIUX-PLAN.md §4 S-22 to S-25, P5-T01c).
 *
 * **Why this page exists.** The four session screens were built across P4-T07
 * to P4-T10 and nothing in the interface linked to any of them. `/session/<id>`
 * was reachable only by typing it, so every session feature in the product was
 * invisible to the people it was built for. This is the door.
 *
 * **Running first, then soonest.** A session in progress is the only row here
 * that somebody is already waiting in, so it sorts above everything and says
 * which step the room is on. After that the list is ordered by when a member
 * has to turn up, which is the question they came to this page with.
 *
 * Finished sessions are behind a link rather than on the page. The front door
 * is about what is next; what happened is the scorecard's job and the digest's.
 */

type Row = Awaited<ReturnType<typeof callAction<"sessions.mine">>>[number];

const KIND_LABEL: Record<string, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

/** The date a member reads, in the workspace's own words rather than an ISO string. */
function whenLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function SessionRow({ row }: { readonly row: Row }) {
  const running = row.state === "running";
  return (
    <Link
      href={`/session/${row.id}`}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-3 transition-colors hover:border-brand hover:bg-raised"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {row.title}
          </span>
          {running ? (
            // The one state that changes what a reader should do next, so it is
            // the one that gets a chip rather than a word in a line of text.
            <Chip tone="brand">In progress</Chip>
          ) : null}
          {row.isFacilitator ? (
            <Chip tone="neutral">You facilitate</Chip>
          ) : null}
        </div>
        <p className="truncate text-xs text-ink-3">
          {KIND_LABEL[row.kind] ?? row.kind}
          {row.spaceName ? ` · ${row.spaceName}` : ""}
          {` · ${whenLabel(row.scheduledFor)}`}
          {running && row.stageKey ? ` · on ${row.stageKey}` : ""}
        </p>
      </div>
      <span className="ml-auto flex-none text-xs font-semibold text-brand-text">
        {running ? "Rejoin" : "Open"}
      </span>
    </Link>
  );
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ finished?: string }>;
}) {
  const { finished } = await searchParams;
  const { session, workspace } = await requireWorkspace();
  const includeFinished = finished === "1";

  const rows = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sessions.mine",
    includeFinished ? { includeFinished: true } : {},
  );

  const running = rows.filter((row) => row.state === "running");
  const ahead = rows.filter((row) => row.state === "scheduled");
  const over = rows.filter(
    (row) => row.state === "closed" || row.state === "skipped",
  );

  return (
    <AppShellLayout>
      <div className="stagger mx-auto flex max-w-3xl flex-col gap-4.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Sessions</h1>
              <p className="text-xs text-ink-3">
                Every session in a space you can read. Anything in progress is
                at the top.
              </p>
            </div>
            <Link
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={includeFinished ? "/sessions" : "/sessions?finished=1"}
            >
              {includeFinished ? "Hide finished" : "Show finished"}
            </Link>
          </CardHeader>
        </Card>

        {rows.length === 0 ? (
          <Card>
            <CardBody>
              <p className="text-sm text-ink-2">
                No sessions in the spaces you can read.
              </p>
              <p className="mt-1 text-xs text-ink-3">
                A session is scheduled from a space. Open a space and start its
                weekly one, or ask its coordinator to.
              </p>
              <Link
                className={`${buttonVariants({ variant: "default", size: "sm" })} mt-3.5 w-fit`}
                href="/spaces"
              >
                Go to spaces
              </Link>
            </CardBody>
          </Card>
        ) : (
          <>
            <Group label="In progress" rows={running} />
            <Group label="Ahead" rows={ahead} />
            {includeFinished ? <Group label="Finished" rows={over} /> : null}
          </>
        )}
      </div>
    </AppShellLayout>
  );
}

function Group({
  label,
  rows,
}: {
  readonly label: string;
  readonly rows: readonly Row[];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="flex items-center gap-2 px-0.5 text-xs font-bold uppercase tracking-wide text-ink-3">
        {label}
        <span className="rounded-full bg-raised px-1.5 py-0.5 text-xs font-semibold text-ink-3">
          {rows.length}
        </span>
      </h2>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <SessionRow key={row.id} row={row} />
        ))}
      </div>
    </section>
  );
}
