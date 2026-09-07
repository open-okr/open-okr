import { Chip } from "@openokr/ui";
import Link from "next/link";

/**
 * The Work Map's context strip, title block and scope tabs (S-01, P3-T11).
 *
 * The mockup at `docs/stakeholder/mockups/png/01-work-map.png` is what this
 * matches. Reference, not authority: every figure here is read from an action,
 * and the two the mockup shows that no table can answer yet, the streak and the
 * blocker text, are absent rather than invented.
 *
 * **The strip is the cycle answering "where are we".** A front door that opened
 * on a tree of goals and never said which phase the workspace is in leaves the
 * one question everybody asks in a planning week unanswered on the one screen
 * everybody opens.
 */

export interface WorkMapStats {
  /** Key results on track, as a percentage of those with a health of their own. */
  readonly onTrackPct: number | null;
  readonly keyResultCount: number;
  readonly objectiveCount: number;
  readonly outdatedGoals: number;
  /** METHOD §5.4's alignment health, out of a hundred. Null before it is computable. */
  readonly alignmentScore: number | null;
  readonly alignmentThreshold: number;
}

export interface WorkMapContext {
  readonly phase: number;
  readonly phaseTitle: string;
  /** The gates that have not passed, by their own titles. */
  readonly unmetGates: readonly string[];
  readonly daysToDeadline: number | null;
  readonly published: boolean;
}

export interface ScopeTab {
  readonly key: string;
  readonly label: string;
  readonly href: string;
}

export function WorkMapContextStrip({
  context,
  cycleHref,
}: {
  readonly context: WorkMapContext | null;
  readonly cycleHref: string;
}) {
  if (!context) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-line border-b pb-2.5 text-xs">
      <Link
        href={cycleHref}
        className="rounded-full border border-line px-2.5 py-1 font-semibold text-ink-2 hover:border-brand"
      >
        Phase {context.phase} · {context.phaseTitle}
      </Link>

      {context.published ? (
        <span className="text-ink-3">Published. The set is live.</span>
      ) : context.unmetGates.length === 0 ? (
        <span className="text-ok">Every gate met.</span>
      ) : (
        // The count, and the one gate's own words only when there is one of
        // them. A gate's title is a full sentence in this product, so naming
        // four would push the deadline off the strip and bury the number
        // somebody actually reads. The link goes where they are all listed.
        <Link href={cycleHref} className="text-warn hover:underline">
          {context.unmetGates.length === 1
            ? `1 gate unmet: ${context.unmetGates[0]}`
            : `${context.unmetGates.length} gates unmet`}
        </Link>
      )}

      {context.daysToDeadline === null ? null : (
        <span
          className={
            context.daysToDeadline < 0
              ? "ml-auto font-semibold text-bad"
              : "ml-auto font-semibold text-brand-text"
          }
        >
          {context.daysToDeadline < 0
            ? `Publication deadline passed ${Math.abs(context.daysToDeadline)} day${Math.abs(context.daysToDeadline) === 1 ? "" : "s"} ago`
            : `Publication deadline in ${context.daysToDeadline} day${context.daysToDeadline === 1 ? "" : "s"}`}
        </span>
      )}
    </div>
  );
}

/**
 * One statistic, or the reason there is none.
 *
 * A figure with no data reads "not yet" rather than zero, because zero is an
 * answer and "nobody has scored anything" is not the same answer.
 */
function Stat({
  label,
  value,
  unit,
  tone,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly tone?: "ok" | "warn" | "bad" | "brand";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "bad"
          ? "text-bad"
          : "text-ink";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold tracking-wider text-ink-4 uppercase">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span className={`text-lg font-bold tabular-nums ${toneClass}`}>
          {value}
        </span>
        {unit ? <span className="text-xs text-ink-3">{unit}</span> : null}
      </span>
    </div>
  );
}

export function WorkMapHeader({
  workspaceName,
  scopeLabel,
  stats,
}: {
  readonly workspaceName: string;
  readonly scopeLabel: string;
  readonly stats: WorkMapStats;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* The screen names itself, the workspace is the subject. The mockup
            puts "Work Map" in the topbar and the workspace name in the title
            block; the topbar is not this component's to change, so the page
            keeps its own name here rather than becoming an unnamed screen. */}
        <h1 className="text-[10px] font-bold tracking-wider text-ink-4 uppercase">
          Work map
        </h1>
        <p className="truncate text-xl font-bold text-ink">{workspaceName}</p>
        <p className="text-xs text-ink-3">
          {scopeLabel} · {stats.objectiveCount} objective
          {stats.objectiveCount === 1 ? "" : "s"} · {stats.keyResultCount} key
          result{stats.keyResultCount === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Stat
          label="On track"
          value={
            stats.onTrackPct === null ? "—" : `${Math.round(stats.onTrackPct)}%`
          }
          unit={stats.onTrackPct === null ? "no measures yet" : "of KRs"}
          tone={
            stats.onTrackPct === null
              ? undefined
              : stats.onTrackPct >= 70
                ? "ok"
                : stats.onTrackPct >= 40
                  ? "warn"
                  : "bad"
          }
        />
        <Stat
          label="Outdated"
          value={String(stats.outdatedGoals)}
          unit={stats.outdatedGoals === 1 ? "goal" : "goals"}
          tone={stats.outdatedGoals > 0 ? "warn" : undefined}
        />
        <Stat
          label="Alignment"
          value={
            stats.alignmentScore === null
              ? "—"
              : String(Math.round(stats.alignmentScore))
          }
          unit={stats.alignmentScore === null ? "not scored yet" : "/100"}
          tone={
            stats.alignmentScore === null
              ? undefined
              : stats.alignmentScore >= stats.alignmentThreshold
                ? "ok"
                : "warn"
          }
        />
      </div>
    </div>
  );
}

export function WorkMapScopeTabs({
  tabs,
  active,
  cycles,
  activeCycleId,
  cycleHrefFor,
}: {
  readonly tabs: readonly ScopeTab[];
  readonly active: string;
  readonly cycles: readonly { readonly id: string; readonly name: string }[];
  readonly activeCycleId: string | null;
  readonly cycleHrefFor: (cycleId: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav aria-label="Scope" className="flex flex-wrap items-center gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? "page" : undefined}
            className={
              tab.key === active
                ? "rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-surface"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-raised"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-1">
        {cycles.length === 0 ? (
          <Chip tone="neutral">No cycle</Chip>
        ) : (
          cycles.map((cycle) => (
            <Link
              key={cycle.id}
              href={cycleHrefFor(cycle.id)}
              aria-current={cycle.id === activeCycleId ? "true" : undefined}
              className={
                cycle.id === activeCycleId
                  ? "rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs font-semibold text-ink"
                  : "rounded-md border border-transparent px-2.5 py-1.5 text-xs text-ink-3 hover:border-line"
              }
            >
              {cycle.name}
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
