import { listTenantsAsOperator, readUsageAsOperator } from "@openokr/core";
import { Chip, type ChipProps } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "../../../lib/operator";
import { getPool } from "../../../lib/pool";
import { LifecycleForm } from "./lifecycle-form";

/**
 * S-46 Operator workspace detail: one tenant (P8-T03b).
 *
 * **No title, name or body from any content table appears here**, and the
 * reason is not discipline: the operator's database connection cannot read
 * one. The property test in `packages/core/test/operator-wall.test.ts` points
 * a real operator connection at all 106 tables carrying a `workspace_id` and
 * requires zero rows from every one.
 *
 * ## What this screen is for, and what the layout says about it
 *
 * An operator reaches this page mid-ticket, and has three jobs: confirm this
 * is the right customer, judge whether the workspace is alive enough to
 * matter, and take an action they might regret. The layout ranks those
 * rather than treating them as three equal sections.
 *
 * **State drives the page, not a chip.** The first version rendered nine
 * identical bordered cards, so "Plan: free", "Members: 1" and "Closed: no"
 * all carried the same weight, and the control that can freeze a customer's
 * workspace looked exactly like the one showing its region. Here a workspace
 * that is not active announces itself in a band across the top, in its own
 * tone, before any number. An active one says nothing, because there is
 * nothing to say.
 *
 * **The five counts share one container and one timestamp**, because they
 * are one measurement taken at one instant. Five separate cards implied five
 * independent facts and pushed the instant that qualifies all of them into a
 * small right-aligned aside.
 *
 * **A fact with no value is absent rather than empty.** No trial end and no
 * closure date are not facts worth a row saying "no".
 *
 * The workspace is found by filtering the operator's own list rather than by
 * a second query. The list already goes through the policy, so a workspace
 * that is not in it is not-found for the same reason and by the same path.
 */
export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, ChipProps["tone"]> = {
  active: "ok",
  suspended: "warn",
  closed: "neutral",
};

/** What a member of this workspace can actually do right now. */
const STATE_CONSEQUENCE: Record<string, string> = {
  suspended:
    "Members can read everything and change nothing, except their own settings and who is in the workspace.",
  closed:
    "The workspace is frozen. Members can still read it and still export it.",
};

/** The band's own colour, which is the state's colour. */
const BAND_STYLE: Record<string, string> = {
  suspended: "border-warn-dot bg-warn-bg text-warn",
  closed: "border-line bg-raised text-ink-2",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)}${units[index]}`;
}

function day(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * One measured number.
 *
 * The figure leads at display size and the label follows beneath it, because
 * an operator scanning this row is reading numbers and using the labels only
 * to place them. `tabular-nums` so the five columns line up whatever the
 * digits.
 */
function Count({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <span className="font-semibold text-2xl text-ink tabular-nums leading-none">
        {value}
      </span>
      <span className="text-ink-3 text-xs">{label}</span>
    </div>
  );
}

/** One label-and-value pair. A definition list, because that is what it is. */
function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <>
      <dt className="text-ink-3 text-sm">{label}</dt>
      <dd className="text-ink text-sm">{value}</dd>
    </>
  );
}

export default async function OperatorWorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const operator = await requireOperator();
  const pool = getPool();

  const tenants = await listTenantsAsOperator(pool, operator.userId);
  const tenant = tenants.find((row) => row.workspaceId === workspaceId);
  if (!tenant) {
    // Not-found, not forbidden. An operator who cannot see this workspace
    // learns nothing about whether it exists, the same answer the access
    // getter gives everywhere else.
    notFound();
  }

  const [usage] = await readUsageAsOperator(pool, operator.userId, workspaceId);
  const consequence = STATE_CONSEQUENCE[tenant.tenantState];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      <Link
        className="w-fit text-ink-2 text-sm hover:text-ink hover:underline"
        href="/operator"
      >
        Back to workspaces
      </Link>

      {/* Identity. The one question an operator must answer before acting is
       * whether this is the right customer, so the name and the slug the
       * customer chose lead, and the tenant facts sit under them rather than
       * in cards of their own. */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-bold text-ink text-xl">{tenant.name}</h1>
          <Chip tone={STATE_TONE[tenant.tenantState] ?? "neutral"}>
            {tenant.tenantState}
          </Chip>
        </div>
        <p className="text-ink-3 text-sm">{tenant.slug}</p>
      </header>

      {/* Only when there is something to say. An active workspace gets no
       * band, because "this workspace is fine" is not news. */}
      {consequence ? (
        <div
          className={`rounded-lg border-l-4 border-y border-r px-4 py-3 ${
            BAND_STYLE[tenant.tenantState] ?? "border-line bg-raised text-ink-2"
          }`}
        >
          <p className="font-semibold text-sm">
            {tenant.tenantState === "closed" && tenant.closedAt
              ? `Closed on ${day(tenant.closedAt)}`
              : `This workspace is ${tenant.tenantState}`}
          </p>
          <p className="mt-1 text-sm opacity-90">{consequence}</p>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-semibold text-ink text-sm">Usage</h2>
          {/* Inside the section heading rather than floating beside the
           * numbers: it qualifies every one of them, and a reader who
           * misses it reads a stale figure as a live one. */}
          <p className="text-ink-3 text-xs">
            {usage
              ? `measured ${new Date(usage.measuredAt).toISOString().replace("T", " ").slice(0, 16)}`
              : "never measured"}
          </p>
        </div>

        {usage ? (
          /* One container, because this is one measurement. Dividers rather
           * than five separate cards, so the shared instant above reads as
           * shared.
           *
           * Two columns on a phone, five from `sm` up. The first version used
           * `min-w-max` inside a scroller so the row would stay comparable on a
           * narrow screen, and that made it overflow at every width: the fifth
           * column was clipped on a 1900px display. A row nobody can see the
           * end of is not comparable either. */
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            {/* Four counts, and the date is not one of them. It sat here at
             * display size and wrapped onto two lines, which broke the row's
             * rhythm and put a date where a reader was scanning integers. A
             * date is a different kind of fact and it reads below. */}
            <div className="grid grid-cols-2 divide-x divide-y divide-line sm:grid-cols-4 sm:divide-y-0">
              <Count label="members" value={String(usage.memberCount)} />
              <Count label="goals" value={String(usage.goalCount)} />
              <Count label="check-ins" value={String(usage.checkInCount)} />
              <Count label="storage" value={formatBytes(usage.storageBytes)} />
            </div>
            <p className="border-line border-t px-4 py-2.5 text-ink-2 text-sm">
              {usage.lastActivityAt
                ? `Last activity ${day(usage.lastActivityAt)}`
                : "No activity has ever been recorded."}
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-ink-2 text-sm">
            Never measured, which is not the same as empty. Run{" "}
            <code className="rounded bg-raised px-1">pnpm cloud:usage</code>.
          </p>
        )}

        <p className="text-ink-3 text-xs">
          Counts only. Nothing a member of this workspace wrote can be read from
          here, and the database enforces that rather than this page.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink text-sm">Tenant</h2>
        {/* A definition list, because a label and a value is what these are.
         * A fact with no value is absent: no trial and no closure date are
         * not worth a row saying "no". */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3">
          <Fact label="Plan" value={tenant.planKey ?? "free"} />
          <Fact
            label="Seats"
            value={tenant.seats === null ? "unlimited" : String(tenant.seats)}
          />
          <Fact label="Region" value={tenant.region} />
          {tenant.closedAt ? (
            <Fact label="Closed" value={day(tenant.closedAt)} />
          ) : null}
        </dl>
      </section>

      <LifecycleForm
        currentState={tenant.tenantState}
        workspaceName={tenant.name}
        workspaceId={tenant.workspaceId}
      />
    </div>
  );
}
