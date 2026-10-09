import {
  defaultOkrKind,
  okrKindsInUse,
  type ResolvedPractice,
  type ResolvedThresholds,
} from "@openokr/method";
import {
  Bar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  formatMeasure,
  MetricInput,
  NumberInput,
  UnitInput,
} from "@openokr/ui";
import { healthWord } from "../../lib/health-words.ts";
import type { KpiOption } from "../../lib/kpi-options.ts";
import { getTranslations } from "../../lib/translations";
import { unitsInUse } from "../../lib/units-in-use.ts";
import { ActionForm } from "./action-form.tsx";
import {
  DraftFromAmbition,
  SuggestMeasure,
  SuggestParent,
} from "./assists.tsx";
import { DraftCoach } from "./draft-coach.tsx";
import {
  addKeyResult,
  createGoal,
  recordValue,
  setKeyResultOwnerAndDate,
} from "./goal-actions.ts";

/**
 * Phase 4's drafting surface (UIUX-PLAN.md §4 S-09, P3-T04).
 *
 * The objective and its key results, editable where they are read, with the
 * Draft Coach beside each objective since P4-T02b: the §4 checks evaluated live
 * as somebody types, from the same package the server stores its answer with.
 * Nothing here invents advice; every prompt is METHOD.md's own sentence and
 * every chip links to the rule.
 *
 * Progress is real since P3-T05: the bar is the weighted average of the key
 * results, recomputed in the same transaction as the write that moved it.
 */

export interface DraftGoal {
  readonly id: string;
  readonly title: string;
  readonly level: string;
  /** Who owns it, which is the unit OBJ-5 counts within (METHOD.md §4.1). */
  readonly ownerKind?: string;
  readonly spaceId?: string | null;
  readonly memberId?: string | null;
  /** Committed or aspirational (METHOD.md §2.8). */
  readonly kind: "committed" | "aspirational";
  readonly progressPct: number;
  readonly health: string;
  readonly contributionStatement: string | null;
  readonly champion: { readonly id: string; readonly name: string };
  /** Null where the goal has none, which the practice allows (P9-T04). */
  readonly reviewer: { readonly id: string; readonly name: string } | null;
  readonly keyResults: readonly {
    readonly id: string;
    readonly title: string;
    readonly unit: string | null;
    readonly direction: string;
    readonly indicatorType: string;
    readonly baselineValue: number;
    /** Null until somebody sets it (P9-T13-b-a). */
    readonly targetValue: number | null;
    readonly currentValue: number;
    readonly weight: number;
    readonly kpiId: string | null;
    readonly dueOn: string | null;
    readonly ownerId: string | null;
    readonly confidence: number | null;
    readonly kind: "metric" | "maintain" | "milestone" | "baseline";
  }[];
}

/** The unit OBJ-5 counts within: the owning space, the owning person, or the company. */
function unitOf(goal: DraftGoal): string {
  if (goal.ownerKind === "space" && goal.spaceId) {
    return `space:${goal.spaceId}`;
  }
  if (goal.ownerKind === "member" && goal.memberId) {
    return `member:${goal.memberId}`;
  }
  return "company";
}

/** How many objectives share this one's level and unit, itself included. */
export function objectivesInUnit(
  goals: readonly DraftGoal[],
  goal: DraftGoal,
): number {
  const unit = unitOf(goal);
  return goals.filter(
    (other) => other.level === goal.level && unitOf(other) === unit,
  ).length;
}

const HEALTH_TONE: Readonly<
  Record<string, "neutral" | "ok" | "warn" | "bad" | "info">
> = {
  pending: "neutral",
  on_track: "ok",
  caution: "warn",
  off_track: "bad",
  outdated: "warn",
  achieved: "ok",
  missed: "bad",
  abandoned: "neutral",
};

export async function Drafting({
  cycleId,
  endsOn,
  draftingAllowed,
  draftingReasons,
  goals,
  members,
  kpis,
  canEdit,
  thresholds,
  practice,
  checkTitles,
  memberId,
  assistsAvailable,
  spaces,
  defaultSpaceId,
  levels,
}: {
  readonly cycleId: string;
  /** The cycle's last day, which a new key result is due on unless changed. */
  readonly endsOn: string;
  /**
   * Whether the workspace's practice lets a new objective be drafted here now
   * (METHOD.md §2.3, §2.9, P9-T02). True by default. False only when the
   * workspace has made the phases bind or chosen a planning window, and then
   * the add forms give way to the policy's own reasons, which are the
   * sentences the server would refuse with. What is already drafted stays
   * editable: finishing a draft is not starting one.
   */
  readonly draftingAllowed: boolean;
  /** Why drafting waits, in the policy's words. Empty when it does not. */
  readonly draftingReasons: readonly string[];
  readonly goals: readonly DraftGoal[];
  readonly members: readonly { readonly id: string; readonly name: string }[];
  /**
   * What a new key result can be measured by, besides a hand-typed value
   * (TECHNICAL-PLAN §6.2, M-07). Null when the list could not be read, which
   * leaves the form working for a key result measured by hand and says so,
   * rather than taking the whole step down with it.
   */
  readonly kpis: readonly KpiOption[] | null;
  readonly canEdit: boolean;
  /** Resolved per workspace, so the browser judges by the same numbers. */
  readonly thresholds: ResolvedThresholds;
  /** How hard each check is here (METHOD.md §12), for the same reason. */
  readonly practice: ResolvedPractice;
  readonly checkTitles: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  /** The reader, who champions and reviews what they apply from a draft. */
  readonly memberId: string;
  /**
   * Whether a provider can answer at all (P4-T15a).
   *
   * False is the normal case and the whole surface below is unchanged by it: the
   * assists are simply not rendered, rather than rendered disabled. A button
   * that cannot do anything is worse than no button, which is the same reason
   * `Topbar` left its own slot empty for two phases.
   */
  readonly assistsAvailable: boolean;
  /**
   * The levels this cycle offers (METHOD v2 §2.7, P9-T07a-c): the ones it
   * began with, plus any its objectives already use. The level picker offers
   * only these, because the policy refuses any other.
   */
  readonly levels: readonly string[];
  /**
   * Where a new objective can be filed (UAT BUG-014). Without a space the
   * objective belongs to the workspace, and a space's sessions, page and
   * alignment picture never see it.
   */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  /** The space the drafter came from, through "Open drafting" on its page. */
  readonly defaultSpaceId: string | null;
}) {
  const { t } = await getTranslations();
  // The units the cycle's key results already use, most used first, for the
  // unit field to offer (guided-inputs §4.8).
  const units = unitsInUse(goals);
  const canDraft = canEdit && draftingAllowed;

  return (
    <div className="flex flex-col gap-4.5">
      {canEdit && !draftingAllowed ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("cycle.drafting.practiceHoldsNewObjectives")}
            </p>
            {draftingReasons.length === 0 ? null : (
              <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-4 text-xs text-ink-3">
                {draftingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {assistsAvailable && canDraft ? (
        <DraftFromAmbition cycleId={cycleId} memberId={memberId} />
      ) : null}

      {goals.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">
              {t("cycle.drafting.nothingDraftedYetAn")}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {goals.map((goal) => (
        <Card key={goal.id}>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h2 className="text-sm font-bold text-ink">{goal.title}</h2>
              <p className="text-xs text-ink-3">
                {goal.reviewer
                  ? t("common.championsItReviewsIt", {
                      level: goal.level,
                      name: goal.champion.name,
                      name2: goal.reviewer.name,
                    })
                  : t("common.championsItNoReviewer", {
                      level: goal.level,
                      name: goal.champion.name,
                    })}
              </p>
            </div>
            <span className="flex flex-none items-center gap-2">
              <Chip tone={HEALTH_TONE[goal.health] ?? "neutral"}>
                {healthWord(t, goal.health)}
              </Chip>
              {assistsAvailable && canEdit ? (
                <SuggestParent goalId={goal.id} />
              ) : null}
              <a
                className="text-xs text-brand-text underline"
                href={`/goals/${goal.id}`}
              >
                {t("cycle.drafting.open")}
              </a>
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <DraftCoach
              objective={{
                id: goal.id,
                title: goal.title,
                hasCycle: true,
                hasTimeframe: false,
                championId: goal.champion.id,
                reviewerId: goal.reviewer?.id ?? null,
                // OBJ-5 counts within the objective's own unit at its level,
                // the way the stored verdict does, never across every space.
                objectivesInUnit: objectivesInUnit(goals, goal),
                level: goal.level as
                  | "company"
                  | "department"
                  | "team"
                  | "individual",
                kind: goal.kind,
              }}
              keyResults={goal.keyResults.map((keyResult) => ({
                id: keyResult.id,
                title: keyResult.title,
                baseline: keyResult.baselineValue,
                target: keyResult.targetValue,
                dueOn: keyResult.dueOn,
                ownerId: keyResult.ownerId,
                indicatorType: keyResult.indicatorType as "leading" | "lagging",
                direction: keyResult.direction as
                  | "increase"
                  | "reduce"
                  | "maintain"
                  | "move",
                confidence: keyResult.confidence,
                keyResultKind: keyResult.kind,
              }))}
              thresholds={thresholds}
              practice={practice}
              checkTitles={checkTitles}
            />

            <div className="flex items-center gap-2.5">
              <Bar
                value={goal.progressPct}
                max={thresholds["scoring.progressCeilingPct"]}
                label={t("cycle.drafting.progressOf", { title: goal.title })}
                className="h-1.5 flex-1"
              />
              <span className="text-xs font-semibold text-ink-3">
                {Math.round(goal.progressPct)}%
              </span>
            </div>

            {goal.contributionStatement ? (
              <p className="text-xs text-ink-3">
                {t("cycle.drafting.contributes", {
                  contributionStatement: goal.contributionStatement,
                })}
              </p>
            ) : (
              <p className="text-xs text-warn">
                {t("cycle.drafting.noParentAndNo")}
              </p>
            )}

            {goal.keyResults.length === 0 ? (
              <p className="text-sm text-ink-3">
                {t("cycle.drafting.noKeyResultsYet")}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {goal.keyResults.map((keyResult) => (
                  <li
                    key={keyResult.id}
                    className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm text-ink">
                          {keyResult.title}
                        </span>
                        <span className="text-xs text-ink-3">
                          {t("common.toWeight", {
                            direction: keyResult.direction,
                            indicatorType: keyResult.indicatorType,
                            baselineValue: formatMeasure(
                              keyResult.baselineValue,
                            ),
                            targetValue:
                              keyResult.targetValue === null
                                ? t("common.noTargetYet")
                                : formatMeasure(keyResult.targetValue),
                            unit: keyResult.unit ? ` ${keyResult.unit}` : "",
                            weight: keyResult.weight,
                          })}
                        </span>
                      </span>
                      <span className="flex-none text-sm font-bold text-ink">
                        {formatMeasure(keyResult.currentValue, keyResult.unit)}
                      </span>
                    </div>
                    {canEdit && !keyResult.kpiId ? (
                      <ActionForm
                        action={recordValue}
                        className="flex items-center gap-1.5"
                      >
                        <input type="hidden" name="id" value={keyResult.id} />
                        {/* guided-inputs §4.8: the unit beside it, and
                            nothing sent from an empty field, which the
                            action refuses in words. */}
                        <MetricInput
                          id={`value-${keyResult.id}`}
                          label={t("common.newValueFor3", {
                            title: keyResult.title,
                          })}
                          hideLabel
                          name="value"
                          unit={keyResult.unit}
                          baseline={keyResult.baselineValue}
                          target={keyResult.targetValue}
                          placeholder={t("cycle.drafting.whereIsItNow")}
                          inputClassName="h-auto w-36 px-2 py-1 text-xs"
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                        >
                          {t("common.record")}
                        </Button>
                      </ActionForm>
                    ) : null}
                    {keyResult.kpiId ? (
                      <p className="text-xs text-ink-3">
                        {t("cycle.drafting.readsItsValueFrom")}
                      </p>
                    ) : null}
                    {canEdit ? (
                      <ActionForm
                        action={setKeyResultOwnerAndDate}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <input type="hidden" name="id" value={keyResult.id} />
                        <label
                          className="sr-only"
                          htmlFor={`owner-${keyResult.id}`}
                        >
                          {t("cycle.drafting.ownerOf", {
                            title: keyResult.title,
                          })}
                        </label>
                        <select
                          id={`owner-${keyResult.id}`}
                          name="ownerId"
                          defaultValue={keyResult.ownerId ?? ""}
                          className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink-2"
                        >
                          <option value="">
                            {t("cycle.drafting.noOwner")}
                          </option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {t("cycle.drafting.ownedBy", {
                                name: member.name,
                              })}
                            </option>
                          ))}
                        </select>
                        <label
                          className="sr-only"
                          htmlFor={`due-${keyResult.id}`}
                        >
                          {t("cycle.drafting.dueDateOf", {
                            title: keyResult.title,
                          })}
                        </label>
                        <input
                          id={`due-${keyResult.id}`}
                          type="date"
                          name="dueOn"
                          defaultValue={keyResult.dueOn ?? ""}
                          className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink-2"
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                        >
                          {t("common.save")}
                        </Button>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canDraft ? (
              <ActionForm
                action={addKeyResult}
                label={t("cycle.drafting.addKeyResultTo", {
                  title: goal.title,
                })}
                className="flex flex-col gap-1.5 rounded-md border border-line border-dashed p-2.5"
              >
                <input type="hidden" name="goalId" value={goal.id} />
                <label className="sr-only" htmlFor={`kr-title-${goal.id}`}>
                  {t("cycle.drafting.theKeyResult")}
                </label>
                <input
                  id={`kr-title-${goal.id}`}
                  name="title"
                  required
                  maxLength={500}
                  placeholder={t("cycle.drafting.whatChangesMeasuredHow")}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {kpis && kpis.length > 0 ? (
                    <>
                      <label className="sr-only" htmlFor={`kr-kpi-${goal.id}`}>
                        {t("cycle.drafting.measuredBy")}
                      </label>
                      {/*
                       * By hand unless somebody chooses otherwise, because
                       * that is what every key result was before a KPI could
                       * be named here, and a default that quietly wired a
                       * measure to a metric would be a decision nobody made.
                       */}
                      <select
                        id={`kr-kpi-${goal.id}`}
                        name="kpiId"
                        defaultValue=""
                        className="max-w-56 rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                      >
                        <option value="">
                          {t("cycle.drafting.measuredByHand")}
                        </option>
                        {kpis.map((kpi) => (
                          <option key={kpi.id} value={kpi.id}>
                            {t("cycle.drafting.readFromKpi", {
                              title: kpi.unit
                                ? `${kpi.title} (${kpi.unit})`
                                : kpi.title,
                            })}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : null}
                  <label className="sr-only" htmlFor={`kr-dir-${goal.id}`}>
                    {t("cycle.drafting.direction")}
                  </label>
                  <select
                    id={`kr-dir-${goal.id}`}
                    name="direction"
                    defaultValue="increase"
                    className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                  >
                    {["increase", "reduce", "maintain", "move"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor={`kr-ind-${goal.id}`}>
                    {t("common.indicator")}
                  </label>
                  <select
                    id={`kr-ind-${goal.id}`}
                    name="indicatorType"
                    defaultValue="leading"
                    className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                  >
                    {["leading", "lagging"].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  {/* `w-32`, because a measure in rupiah or impressions
                      runs to nine digits. No `max`: the ceiling on a measure
                      is the unit's, not the product's. */}
                  <NumberInput
                    id={`kr-base-${goal.id}`}
                    label={t("cycle.drafting.baseline")}
                    hideLabel
                    name="baselineValue"
                    required
                    placeholder={t("cycle.drafting.baseline")}
                    inputClassName="w-32 text-xs"
                  />
                  <NumberInput
                    id={`kr-target-${goal.id}`}
                    label={t("common.target")}
                    hideLabel
                    name="targetValue"
                    required
                    placeholder={t("common.target")}
                    inputClassName="w-32 text-xs"
                  />
                  <label className="sr-only" htmlFor={`kr-owner-${goal.id}`}>
                    {t("cycle.drafting.owner")}
                  </label>
                  <select
                    id={`kr-owner-${goal.id}`}
                    name="ownerId"
                    defaultValue={goal.champion.id}
                    className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                  >
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {t("cycle.drafting.ownedBy", { name: member.name })}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor={`kr-due-${goal.id}`}>
                    {t("cycle.drafting.dueOn")}
                  </label>
                  <input
                    id={`kr-due-${goal.id}`}
                    type="date"
                    name="dueOn"
                    defaultValue={endsOn}
                    className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                  />
                  <UnitInput
                    id={`kr-unit-${goal.id}`}
                    label={t("cycle.drafting.unit")}
                    hideLabel
                    name="unit"
                    known={units}
                    placeholder={t("cycle.drafting.unit")}
                    inputClassName="w-24 text-xs"
                  />
                  <Button type="submit">
                    {t("cycle.drafting.addKeyResult")}
                  </Button>
                </div>
                {kpis === null ? (
                  <p role="status" className="text-xs text-warn">
                    {t("cycle.drafting.kpisUnavailable")}
                  </p>
                ) : kpis.length === 0 ? (
                  <p className="text-xs text-ink-4">
                    {t("cycle.drafting.noKpisYet")}{" "}
                    <a className="underline" href="/kpis">
                      {t("cycle.drafting.addAKpi")}
                    </a>
                  </p>
                ) : (
                  <p className="text-xs text-ink-4">
                    {t("cycle.drafting.readFromKpiHelp")}
                  </p>
                )}
              </ActionForm>
            ) : null}

            {assistsAvailable && canDraft ? (
              <SuggestMeasure goalId={goal.id} />
            ) : null}
          </CardBody>
        </Card>
      ))}

      {canDraft ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              {t("cycle.drafting.draftAnObjective")}
            </h2>
          </CardHeader>
          <CardBody>
            <ActionForm action={createGoal} className="flex flex-col gap-1.5">
              <input type="hidden" name="cycleId" value={cycleId} />
              <label className="sr-only" htmlFor="goal-title">
                {t("common.theObjective")}
              </label>
              <input
                id="goal-title"
                name="title"
                required
                maxLength={500}
                placeholder={t("cycle.drafting.whatIsDifferentAt")}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
              />
              <label className="sr-only" htmlFor="goal-contribution">
                {t("common.whatItContributesTo")}
              </label>
              <input
                id="goal-contribution"
                name="contributionStatement"
                maxLength={1000}
                placeholder={t("common.thePriorityThisMoves")}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="sr-only" htmlFor="goal-level">
                  {t("common.level")}
                </label>
                <select
                  id="goal-level"
                  name="level"
                  defaultValue={levels[0] ?? "company"}
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  {levels.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="goal-champion">
                  {t("common.champion")}
                </label>
                <select
                  id="goal-champion"
                  name="championId"
                  required
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {t("cycle.drafting.champion", { name: member.name })}
                    </option>
                  ))}
                </select>
                {/* The kind of promise (METHOD.md §2.8, P9-T11b-a), offered
                 * only where the workspace uses both, and starting at its
                 * default (decision D2). */}
                {okrKindsInUse(practice).length > 1 ? (
                  <>
                    <label className="sr-only" htmlFor="goal-kind">
                      {t("okrKind.label")}
                    </label>
                    <select
                      id="goal-kind"
                      name="kind"
                      defaultValue={defaultOkrKind(practice)}
                      className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                    >
                      <option value="aspirational">
                        {t("okrKind.aspirational")}
                      </option>
                      <option value="committed">
                        {t("okrKind.committed")}
                      </option>
                    </select>
                  </>
                ) : null}
                {/* The reviewer follows the practice (METHOD.md §2.5, P9-T04):
                 * off asks for none, so there is no picker; optional offers
                 * "No reviewer" after the members; required offers members
                 * only, and the server refuses a goal without one either way. */}
                {practice.reviewer === "off" ? null : (
                  <>
                    <label className="sr-only" htmlFor="goal-reviewer">
                      {t("common.reviewer")}
                    </label>
                    <select
                      id="goal-reviewer"
                      name="reviewerId"
                      required={practice.reviewer === "required"}
                      className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                    >
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {t("cycle.drafting.reviewer", { name: member.name })}
                        </option>
                      ))}
                      {practice.reviewer === "optional" ? (
                        <option value="">
                          {t("cycle.drafting.noReviewer")}
                        </option>
                      ) : null}
                    </select>
                  </>
                )}
                {spaces.length > 0 ? (
                  <>
                    <label className="sr-only" htmlFor="goal-space">
                      {t("cycle.drafting.space")}
                    </label>
                    <select
                      id="goal-space"
                      name="spaceId"
                      defaultValue={
                        spaces.some((space) => space.id === defaultSpaceId)
                          ? (defaultSpaceId ?? "")
                          : ""
                      }
                      className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                    >
                      <option value="">{t("cycle.drafting.noSpace")}</option>
                      {spaces.map((space) => (
                        <option key={space.id} value={space.id}>
                          {t("cycle.drafting.inSpace", { name: space.name })}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}
                <Button type="submit" variant="primary">
                  {t("cycle.drafting.addObjective")}
                </Button>
              </div>
              <p className="text-xs text-ink-3">
                {t("cycle.drafting.methodMd")}
              </p>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
