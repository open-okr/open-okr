import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "./action-form.tsx";
import { linkToStrategy, sendForward } from "./frame-actions.ts";

/**
 * The year's objectives, under the strategy each serves (S-05, P6-G14b).
 *
 * **§2.1's frame is two to five strategies, and nothing pointed at one.**
 * `annual_strategies` has held them since migration 0020 and a goal could name
 * a parent goal, a parent key result, a cycle, a space and a member, and never
 * the strategy it existed to advance. Migration 0076 adds that column, so this
 * phase can answer the question it is for: which of the year's strategies does
 * each of the year's objectives actually move.
 *
 * **An objective serving no strategy gets its own heading rather than being
 * hidden.** That is the thing §2.1 exists to surface, and a screen that files
 * it silently under "other" is the screen not doing its job.
 *
 * **Sending forward is `goals.create` with a parent**, not a new verb. The
 * parent pointer is the link the alignment engine already reads, and a second
 * way to write it would be a second thing to keep correct.
 */

export interface AnnualObjective {
  readonly id: string;
  readonly title: string;
  readonly strategyId: string | null;
  readonly championName: string | null;
  readonly keyResultCount: number;
  readonly sentForward: number;
}

export interface Strategy {
  readonly id: string;
  readonly text: string;
  readonly note: string | null;
}

async function Objective({
  objective,
  strategies,
  canEdit,
  championId,
  reviewerId,
}: {
  readonly objective: AnnualObjective;
  readonly strategies: readonly Strategy[];
  readonly canEdit: boolean;
  readonly championId: string;
  readonly reviewerId: string;
}) {
  const { t } = await getTranslations();

  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <Link
          href={`/goals/${objective.id}`}
          className="min-w-0 text-sm text-ink hover:underline"
        >
          {objective.title}
          <span className="ml-1.5 text-xs text-ink-3">
            {objective.championName ?? "No champion named"}
          </span>
        </Link>
        <span className="flex flex-none items-center gap-2">
          <Chip tone={objective.keyResultCount > 0 ? "neutral" : "warn"}>
            {objective.keyResultCount === 0
              ? "no key results"
              : `${objective.keyResultCount} key results`}
          </Chip>
          {objective.sentForward > 0 ? (
            <Chip tone="ok">
              {t("cycle.annualObjectives.in")} {objective.sentForward}{" "}
              {t("cycle.annualObjectives.quarter")}
              {objective.sentForward === 1 ? "" : "s"}
            </Chip>
          ) : null}
        </span>
      </div>

      {canEdit ? (
        <ActionForm
          action={linkToStrategy}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="goalId" value={objective.id} />
          <select
            name="strategyId"
            defaultValue={objective.strategyId ?? ""}
            aria-label={`The strategy ${objective.title} serves`}
            className="w-96 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
          >
            <option value="">
              {t("cycle.annualObjectives.servingNoStrategy")}
            </option>
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.text}
              </option>
            ))}
          </select>
          <Button type="submit" variant="ghost" size="sm">
            {t("common.link")}
          </Button>
        </ActionForm>
      ) : null}

      {canEdit ? (
        <ActionForm
          action={sendForward}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="goalId" value={objective.id} />
          <input type="hidden" name="championId" value={championId} />
          <input type="hidden" name="reviewerId" value={reviewerId} />
          <input
            name="title"
            defaultValue={objective.title}
            aria-label={`This quarter's objective under ${objective.title}`}
            className="w-96 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
          />
          <Button type="submit" variant="default" size="sm">
            {t("cycle.annualObjectives.sendIntoThisQuarter")}
          </Button>
        </ActionForm>
      ) : null}
    </div>
  );
}

export async function AnnualObjectives({
  strategies,
  objectives,
  canEdit,
  championId,
  reviewerId,
  frameAgreed,
}: {
  readonly strategies: readonly Strategy[];
  readonly objectives: readonly AnnualObjective[];
  readonly canEdit: boolean;
  /** Who a sent-forward objective is championed by: the reader. */
  readonly championId: string;
  readonly reviewerId: string;
  /**
   * Whether leadership agreement on the frame is recorded.
   *
   * §2.1's own condition, and the annual planning gate already refuses to pass
   * without it. Repeated here as a line rather than as a new rule, because a
   * facilitator looking at the year's objectives is exactly who needs to know
   * the frame under them is not agreed yet, and inventing a second rule key
   * for something the canon already gates would be changing practice.
   */
  readonly frameAgreed: boolean;
}) {
  const { t } = await getTranslations();

  const unlinked = objectives.filter((one) => one.strategyId === null);

  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("cycle.annualObjectives.theYearSObjectives")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("cycle.annualObjectives.eachUnderTheStrategy")}
          </p>
        </div>
        {frameAgreed ? null : (
          <Chip tone="warn">{t("cycle.annualObjectives.frameNotAgreed")}</Chip>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        {frameAgreed ? null : (
          <p className="text-xs text-warn">
            {t("cycle.annualObjectives.leadershipAgreementOnThe")}
          </p>
        )}

        {objectives.length === 0 ? (
          <p className="text-xs text-ink-3">
            {t("cycle.annualObjectives.noAnnualObjectivesYet")}
          </p>
        ) : null}

        {strategies.map((strategy) => {
          const serving = objectives.filter(
            (one) => one.strategyId === strategy.id,
          );
          return (
            <div key={strategy.id} className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-ink-2">
                  {strategy.text}
                </span>
                {strategy.note ? (
                  <span className="text-xs text-ink-4">{strategy.note}</span>
                ) : null}
              </div>
              {serving.length === 0 ? (
                <p className="text-xs text-ink-3">
                  {t("cycle.annualObjectives.nothingIsMovingThis")}
                </p>
              ) : (
                serving.map((objective) => (
                  <Objective
                    key={objective.id}
                    objective={objective}
                    strategies={strategies}
                    canEdit={canEdit}
                    championId={championId}
                    reviewerId={reviewerId}
                  />
                ))
              )}
            </div>
          );
        })}

        {unlinked.length > 0 ? (
          <div className="flex flex-col gap-1.5 rounded-lg border border-warn-dot bg-warn-bg p-3">
            <span className="text-xs font-semibold text-warn">
              {t("cycle.annualObjectives.servingNoStrategy")}
            </span>
            <p className="text-xs text-ink-3">
              {t("cycle.annualObjectives.theseAreTheOnes")}
            </p>
            {unlinked.map((objective) => (
              <Objective
                key={objective.id}
                objective={objective}
                strategies={strategies}
                canEdit={canEdit}
                championId={championId}
                reviewerId={reviewerId}
              />
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
