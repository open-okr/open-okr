import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getTranslations } from "../../lib/translations";
import { ActionForm } from "./action-form.tsx";
import { addPriority } from "./actions.ts";
import type { Issue } from "./diagnose.tsx";

/**
 * Phase 3's priorities (UIUX-PLAN.md §4 S-08).
 *
 * A priority can answer an issue from phase 2, and choosing one records the link
 * back so the diagnosis and the direction stay connected. §2.3 asks an annual
 * cycle for three to five priorities each carrying a twelve-month success
 * statement, so the statement is a field on the form rather than an afterthought.
 *
 * "Promoting a priority creates an objective linked back to it" is the other half
 * of the task's test plan, and it needs objectives. Those arrive at P3-T04, so the
 * promotion recorded here stops at the priority.
 */
export async function Direction({
  cycleId,
  mode,
  priorities,
  issues,
  bounds,
  canEdit,
}: {
  readonly cycleId: string;
  readonly mode: "annual" | "quarterly";
  readonly priorities: readonly {
    readonly id: string;
    readonly text: string;
    readonly successStatement: string | null;
  }[];
  readonly issues: readonly Issue[];
  readonly bounds: { readonly low: number; readonly high: number };
  readonly canEdit: boolean;
}) {
  const { t } = await getTranslations();

  const withinBounds =
    priorities.length >= bounds.low && priorities.length <= bounds.high;
  const unpromoted = issues.filter((issue) => !issue.promotedToPriorityId);

  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">
          {t("cycle.direction.priorities")}
        </h2>
        {mode === "annual" ? (
          <Chip tone={withinBounds ? "ok" : "warn"}>
            {priorities.length} {t("common.of")} {bounds.low} {t("common.to")}{" "}
            {bounds.high}
          </Chip>
        ) : (
          <Chip tone="neutral">
            {priorities.length} {t("cycle.direction.chosen")}
          </Chip>
        )}
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        {mode === "quarterly" ? (
          <p className="text-sm text-ink-3">
            {t("cycle.direction.aQuarterlyCycleRevalidates")}
          </p>
        ) : null}

        {priorities.length === 0 ? (
          <p className="text-sm text-ink-3">
            {t("cycle.direction.nothingChosenYetA")}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-line">
            {priorities.map((priority) => (
              <li
                key={priority.id}
                className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="text-sm font-semibold text-ink">
                  {priority.text}
                </span>
                <span className="text-xs text-ink-3">
                  {priority.successStatement ??
                    "No success statement, so nobody can tell whether it worked"}
                </span>
              </li>
            ))}
          </ol>
        )}

        {canEdit ? (
          <ActionForm action={addPriority} className="flex flex-col gap-1.5">
            <input type="hidden" name="cycleId" value={cycleId} />
            <label className="sr-only" htmlFor="new-priority">
              {t("cycle.direction.thePriority")}
            </label>
            <input
              id="new-priority"
              name="text"
              required
              maxLength={500}
              placeholder={t("cycle.direction.whatHasToBe")}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
            />
            <label className="sr-only" htmlFor="new-priority-success">
              {t("cycle.direction.theSuccessStatement")}
            </label>
            <input
              id="new-priority-success"
              name="successStatement"
              maxLength={1000}
              placeholder={t("cycle.direction.howWeWillKnow")}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
            />
            <div className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor="new-priority-issue">
                {t("cycle.direction.theIssueThisAnswers")}
              </label>
              <select
                id="new-priority-issue"
                name="fromIssueId"
                defaultValue=""
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink-2"
              >
                <option value="">
                  {t("cycle.direction.answersNoIssueOn")}
                </option>
                {unpromoted.map((issue) => (
                  <option key={issue.id} value={issue.id}>
                    {t("common.impact")} {issue.impact} · {issue.text}
                  </option>
                ))}
              </select>
              <Button type="submit">{t("common.add")}</Button>
            </div>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
