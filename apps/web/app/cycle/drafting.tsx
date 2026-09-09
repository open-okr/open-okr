import type { ResolvedThresholds } from "@openokr/method";
import { Bar, Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "./action-form.tsx";
import {
  DraftFromAmbition,
  SuggestMeasure,
  SuggestParent,
} from "./assists.tsx";
import { DraftCoach } from "./draft-coach.tsx";
import { addKeyResult, createGoal, recordValue } from "./goal-actions.ts";

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
  readonly progressPct: number;
  readonly health: string;
  readonly contributionStatement: string | null;
  readonly champion: { readonly id: string; readonly name: string };
  readonly reviewer: { readonly id: string; readonly name: string };
  readonly keyResults: readonly {
    readonly id: string;
    readonly title: string;
    readonly unit: string | null;
    readonly direction: string;
    readonly indicatorType: string;
    readonly baselineValue: number;
    readonly targetValue: number;
    readonly currentValue: number;
    readonly weight: number;
    readonly kpiId: string | null;
    readonly dueOn: string | null;
    readonly ownerId: string | null;
    readonly confidence: number | null;
  }[];
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
};

export async function Drafting({
  cycleId,
  goals,
  members,
  canEdit,
  thresholds,
  checkTitles,
  memberId,
  assistsAvailable,
}: {
  readonly cycleId: string;
  readonly goals: readonly DraftGoal[];
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly canEdit: boolean;
  /** Resolved per workspace, so the browser judges by the same numbers. */
  readonly thresholds: ResolvedThresholds;
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
}) {
  const { t } = await getTranslations();

  return (
    <div className="flex flex-col gap-4.5">
      {assistsAvailable && canEdit ? (
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
                {goal.level} · {goal.champion.name} {t("common.championsIt")}{" "}
                {goal.reviewer.name} {t("cycle.drafting.reviewsIt")}
              </p>
            </div>
            <span className="flex flex-none items-center gap-2">
              <Chip tone={HEALTH_TONE[goal.health] ?? "neutral"}>
                {goal.health.replace("_", " ")}
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
                reviewerId: goal.reviewer.id,
                // Every objective on this screen belongs to the cycle being
                // drafted, and they share a level per row, so the count the
                // per-unit cap reads is the number on screen at this level.
                objectivesInUnit: goals.filter(
                  (other) => other.level === goal.level,
                ).length,
                level: goal.level as
                  | "company"
                  | "department"
                  | "team"
                  | "individual",
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
              }))}
              thresholds={thresholds}
              checkTitles={checkTitles}
            />

            <div className="flex items-center gap-2.5">
              <Bar value={goal.progressPct} className="h-1.5 flex-1" />
              <span className="text-xs font-semibold text-ink-3">
                {Math.round(goal.progressPct)}%
              </span>
            </div>

            {goal.contributionStatement ? (
              <p className="text-xs text-ink-3">
                {t("cycle.drafting.contributes")} {goal.contributionStatement}
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
                          {keyResult.direction} · {keyResult.indicatorType} ·{" "}
                          {keyResult.baselineValue} {t("common.to")}{" "}
                          {keyResult.targetValue}
                          {keyResult.unit ? ` ${keyResult.unit}` : ""}{" "}
                          {t("common.weight")} {keyResult.weight}
                        </span>
                      </span>
                      <span className="flex-none text-sm font-bold text-ink">
                        {keyResult.currentValue}
                        {keyResult.unit ? ` ${keyResult.unit}` : ""}
                      </span>
                    </div>
                    {canEdit && !keyResult.kpiId ? (
                      <ActionForm
                        action={recordValue}
                        className="flex items-center gap-1.5"
                      >
                        <input type="hidden" name="id" value={keyResult.id} />
                        <label
                          className="sr-only"
                          htmlFor={`value-${keyResult.id}`}
                        >
                          {t("common.newValueFor")} {keyResult.title}
                        </label>
                        <input
                          id={`value-${keyResult.id}`}
                          name="value"
                          type="number"
                          step="any"
                          required
                          placeholder={t("cycle.drafting.whereIsItNow")}
                          className="w-36 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-4"
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
                  </li>
                ))}
              </ul>
            )}

            {canEdit ? (
              <ActionForm
                action={addKeyResult}
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
                  <label className="sr-only" htmlFor={`kr-base-${goal.id}`}>
                    {t("cycle.drafting.baseline")}
                  </label>
                  <input
                    id={`kr-base-${goal.id}`}
                    name="baselineValue"
                    type="number"
                    step="any"
                    required
                    placeholder={t("cycle.drafting.baseline")}
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-4"
                  />
                  <label className="sr-only" htmlFor={`kr-target-${goal.id}`}>
                    {t("common.target")}
                  </label>
                  <input
                    id={`kr-target-${goal.id}`}
                    name="targetValue"
                    type="number"
                    step="any"
                    required
                    placeholder={t("common.target")}
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-4"
                  />
                  <label className="sr-only" htmlFor={`kr-unit-${goal.id}`}>
                    {t("cycle.drafting.unit")}
                  </label>
                  <input
                    id={`kr-unit-${goal.id}`}
                    name="unit"
                    maxLength={60}
                    placeholder={t("cycle.drafting.unit")}
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-4"
                  />
                  <Button type="submit">
                    {t("cycle.drafting.addKeyResult")}
                  </Button>
                </div>
              </ActionForm>
            ) : null}

            {assistsAvailable && canEdit ? (
              <SuggestMeasure goalId={goal.id} />
            ) : null}
          </CardBody>
        </Card>
      ))}

      {canEdit ? (
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
                  defaultValue="company"
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  {["company", "department", "team", "individual"].map(
                    (value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ),
                  )}
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
                      {t("cycle.drafting.champion2")} {member.name}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="goal-reviewer">
                  {t("common.reviewer")}
                </label>
                <select
                  id="goal-reviewer"
                  name="reviewerId"
                  required
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {t("cycle.drafting.reviewer2")} {member.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="primary">
                  {t("cycle.drafting.addObjective")}
                </Button>
              </div>
              <p className="text-xs text-ink-3">
                {t("cycle.drafting.methodMd25")}
              </p>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
