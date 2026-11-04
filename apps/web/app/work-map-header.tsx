import { Chip, type MessageValues, Tooltip } from "@openokr/ui";
import { Info } from "lucide-react";
import Link from "next/link";
import { NavSelect } from "../lib/nav-select.tsx";
import { getTranslations } from "../lib/translations";

/**
 * The Work Map's context strip, title block and scope tabs (S-01, P3-T11).
 *
 * The mockup at `docs/mockups/png/01-work-map.png` is what this
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
  /** §3.5's reading of the share, which is what colours it. */
  readonly onTrackBand: "healthy" | "watch" | "at_risk" | null;
  readonly keyResultCount: number;
  readonly objectiveCount: number;
  readonly outdatedGoals: number;
  /** METHOD §5.4's alignment health, out of a hundred. Null before it is computable. */
  readonly alignmentScore: number | null;
  /** §5.2's reading of the share, which is what colours it. */
  readonly alignmentBand: "healthy" | "watch" | "gap" | null;
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

type Translate = (key: string, values?: MessageValues) => string;

const daysPhrase = (count: number, t: Translate): string =>
  count === 1
    ? t("common.count.dayOne", { count })
    : t("common.count.dayOther", { count });

export async function WorkMapContextStrip({
  context,
  cycleHref,
}: {
  readonly context: WorkMapContext | null;
  readonly cycleHref: string;
}) {
  const { t } = await getTranslations();

  if (!context) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-line border-b pb-2.5 text-xs"
      // The Work Map's own cycle strip, which stays after publishing when the
      // shell's goes. The tour's cycle stop outlines both (L-08).
      data-tour-target="cycle-strip"
    >
      <Link
        href={cycleHref}
        className="rounded-full border border-line px-2.5 py-1 font-semibold text-ink-2 hover:border-brand"
      >
        {t("common.phase3", {
          phase: context.phase,
          phaseTitle: context.phaseTitle,
        })}
      </Link>

      {context.published ? (
        <span className="text-ink-3">
          {t("workMapHeader.publishedTheSetIs")}
        </span>
      ) : context.unmetGates.length === 0 ? (
        <span className="text-ok">{t("workMapHeader.everyGateMet")}</span>
      ) : (
        // The count, and the one gate's own words only when there is one of
        // them. A gate's title is a full sentence in this product, so naming
        // four would push the deadline off the strip and bury the number
        // somebody actually reads. The link goes where they are all listed.
        <Link href={cycleHref} className="text-warn hover:underline">
          {context.unmetGates.length === 1
            ? t("workMapHeader.oneGateUnmet", {
                gate: context.unmetGates[0] ?? "",
              })
            : t("workMapHeader.gatesUnmet", {
                gates: t("common.count.gateOther", {
                  count: context.unmetGates.length,
                }),
              })}
        </Link>
      )}

      {/* Once the set is published the deadline has been met or overtaken,
          and a red "passed" beside "Published. The set is live." read as a
          fault nobody could act on (UAT BUG-016). */}
      {context.daysToDeadline === null || context.published ? null : (
        <span
          className={
            context.daysToDeadline < 0
              ? "ml-auto font-semibold text-bad"
              : "ml-auto font-semibold text-brand-text"
          }
        >
          {context.daysToDeadline < 0
            ? t("workMapHeader.deadlinePassed", {
                days: daysPhrase(Math.abs(context.daysToDeadline), t),
              })
            : t("workMapHeader.deadlineIn", {
                days: daysPhrase(context.daysToDeadline, t),
              })}
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
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly tone?: "ok" | "warn" | "bad" | "brand";
  /** What the figure counts, on hover and focus (usability review O1). */
  readonly hint?: string;
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
      <span className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-ink-4 uppercase">
        {label}
        {hint ? (
          <Tooltip label={hint}>
            <button
              type="button"
              aria-label={hint}
              className="inline-flex size-6 items-center justify-center rounded text-ink-4 hover:text-ink-2"
            >
              <Info aria-hidden="true" className="size-3" />
            </button>
          </Tooltip>
        ) : null}
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

export async function WorkMapHeader({
  workspaceName,
  scopeLabel,
  stats,
}: {
  readonly workspaceName: string;
  readonly scopeLabel: string;
  readonly stats: WorkMapStats;
}) {
  const { t } = await getTranslations();

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* The screen names itself, the workspace is the subject. The mockup
            puts "Work Map" in the topbar and the workspace name in the title
            block; the topbar is not this component's to change, so the page
            keeps its own name here rather than becoming an unnamed screen. */}
        {/* `--ink-3`, not `--ink-4`. The ramp's own comment says ink-4 is
            "placeholders and disabled labels only. Deliberately below 4.5",
            and this is neither: it is the screen's name, on every page, at
            10px. P7-T05's scan reported it as a serious contrast finding on
            every screen in the product, which is one defect wearing thirty
            hats. */}
        <h1 className="text-[10px] font-bold tracking-wider text-ink-3 uppercase">
          {t("workMapHeader.workMap")}
        </h1>
        <p className="truncate text-xl font-bold text-ink">{workspaceName}</p>
        <p className="text-xs text-ink-3">
          {t("workMapHeader.scopeSummary", {
            scopeLabel,
            objectives:
              stats.objectiveCount === 1
                ? t("common.count.objectiveOne", {
                    count: stats.objectiveCount,
                  })
                : t("common.count.objectiveOther", {
                    count: stats.objectiveCount,
                  }),
            keyResults:
              stats.keyResultCount === 1
                ? t("common.count.keyResultOne", {
                    count: stats.keyResultCount,
                  })
                : t("common.count.keyResultOther", {
                    count: stats.keyResultCount,
                  }),
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Stat
          label={t("common.onTrack")}
          hint={t("workMapHeader.onTrackHint")}
          value={
            stats.onTrackPct === null ? "—" : `${Math.round(stats.onTrackPct)}%`
          }
          unit={
            stats.onTrackPct === null
              ? t("workMapHeader.noMeasuresYet")
              : t("workMapHeader.ofKrs")
          }
          tone={
            stats.onTrackBand === null
              ? undefined
              : stats.onTrackBand === "healthy"
                ? "ok"
                : stats.onTrackBand === "watch"
                  ? "warn"
                  : "bad"
          }
        />
        <Stat
          label={t("workMapHeader.outdated")}
          hint={t("workMapHeader.outdatedHint")}
          value={String(stats.outdatedGoals)}
          unit={
            stats.outdatedGoals === 1
              ? t("workMapHeader.outdatedUnitOne")
              : t("workMapHeader.outdatedUnitOther")
          }
          tone={stats.outdatedGoals > 0 ? "warn" : undefined}
        />
        <Stat
          label={t("goals.alignment")}
          hint={t("workMapHeader.alignmentHint")}
          value={
            stats.alignmentScore === null
              ? "—"
              : String(Math.round(stats.alignmentScore))
          }
          unit={
            stats.alignmentScore === null
              ? t("workMapHeader.notScoredYet")
              : "%"
          }
          tone={
            stats.alignmentBand === null
              ? undefined
              : stats.alignmentBand === "healthy"
                ? "ok"
                : stats.alignmentBand === "watch"
                  ? "warn"
                  : "bad"
          }
        />
      </div>
    </div>
  );
}

/**
 * Company, then one picker for a space and one for the cycle (usability
 * review O2, O3). Nine space tabs and a year of cycle links wrapped onto
 * three lines, and the workspace's own first space sat among them as if it
 * were a team: it is the company, which the Company tab already is.
 */
export async function WorkMapScopeTabs({
  tabs,
  active,
  spaces,
  cycles,
  activeCycleId,
  cycleHrefFor,
}: {
  readonly tabs: readonly ScopeTab[];
  readonly active: string;
  /** Every space but the company's own, each with its address. */
  readonly spaces: readonly ScopeTab[];
  readonly cycles: readonly {
    readonly id: string;
    readonly name: string;
    readonly startsOn: string;
    readonly endsOn: string;
  }[];
  readonly activeCycleId: string | null;
  readonly cycleHrefFor: (cycleId: string) => string;
}) {
  const { t } = await getTranslations();
  // Newest first, and a quarter before the year that starts with it, so the
  // year no longer sits between two of its quarters (O3).
  const ordered = [...cycles].sort(
    (a, b) =>
      b.startsOn.localeCompare(a.startsOn) || a.endsOn.localeCompare(b.endsOn),
  );
  const company = tabs[0];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <nav
        aria-label={t("common.scope")}
        className="flex flex-wrap items-center gap-1"
      >
        {company ? (
          <Link
            href={company.href}
            aria-current={active === company.key ? "page" : undefined}
            className={
              active === company.key
                ? "rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-surface"
                : "rounded-md px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-raised"
            }
          >
            {company.label}
          </Link>
        ) : null}
        {spaces.length > 0 && company ? (
          <>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
            <NavSelect
              label={t("workMap.scope.space")}
              value={active}
              testId="work-map-space"
              options={[
                {
                  value: company.key,
                  label: t("goals.all"),
                  href: company.href,
                },
                ...spaces.map((space) => ({
                  value: space.key,
                  label: space.label,
                  href: space.href,
                })),
              ]}
            />
          </>
        ) : null}
      </nav>

      {ordered.length === 0 || activeCycleId === null ? (
        <Chip tone="neutral">{t("workMapHeader.noCycle")}</Chip>
      ) : (
        <NavSelect
          label={t("workMap.scope.cycle")}
          value={activeCycleId}
          testId="work-map-cycle"
          options={ordered.map((cycle) => ({
            value: cycle.id,
            label: cycle.name,
            href: cycleHrefFor(cycle.id),
          }))}
        />
      )}
    </div>
  );
}
