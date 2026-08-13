import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { ActionForm } from "./action-form.tsx";
import { addIssue, rankIssue } from "./actions.ts";

/**
 * Phase 2's ranked strategic issue list (UIUX-PLAN.md §4 S-07: "an impact
 * selector that reorders live").
 *
 * The order is the impact order, read back from the server after each change
 * rather than kept in the browser. §2.3 asks for at least five ranked issues
 * before the phase is complete, and the count is stated here so nobody has to
 * count rows to find out how far off they are.
 *
 * Scoring the prior cycle, the other half of S-07, needs key result rows and
 * arrives with them at P3-T04. Baseline health has its write
 * (`workflow.setBaselineHealth`) but its editor is the rich text three-column
 * surface, which belongs with the phase 2 screen at that same task.
 */

export interface Issue {
  readonly id: string;
  readonly text: string;
  readonly impact: number;
  readonly source: string;
  readonly promotedToPriorityId: string | null;
}

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  manual: "Raised here",
  carry_forward: "Carried forward",
  process_health: "Process health",
  coach: "Proposed by the Coach",
};

export function Diagnose({
  cycleId,
  issues,
  minimum,
  canEdit,
}: {
  readonly cycleId: string;
  readonly issues: readonly Issue[];
  readonly minimum: number;
  readonly canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">Strategic issues</h2>
        <Chip tone={issues.length >= minimum ? "ok" : "warn"}>
          {issues.length} ranked, {minimum} asked for
        </Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        {issues.length === 0 ? (
          <p className="text-sm text-ink-3">
            Nothing is on the list yet. §2.3 asks for at least {minimum} ranked
            issues before the diagnosis is done.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-line">
            {issues.map((issue) => (
              <li
                key={issue.id}
                className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm text-ink">{issue.text}</span>
                  <span className="text-xs text-ink-3">
                    {SOURCE_LABEL[issue.source] ?? issue.source}
                    {issue.promotedToPriorityId
                      ? " · promoted to a priority"
                      : ""}
                  </span>
                </span>
                {canEdit ? (
                  <ActionForm
                    action={rankIssue}
                    className="flex flex-none items-center gap-1.5"
                  >
                    <input type="hidden" name="cycleId" value={cycleId} />
                    <input type="hidden" name="issueId" value={issue.id} />
                    <label className="sr-only" htmlFor={`impact-${issue.id}`}>
                      Impact for {issue.text}
                    </label>
                    <select
                      id={`impact-${issue.id}`}
                      name="impact"
                      defaultValue={String(issue.impact)}
                      className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink-2"
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          Impact {value}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="submit"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                    >
                      Rank
                    </Button>
                  </ActionForm>
                ) : (
                  <Chip tone="neutral">Impact {issue.impact}</Chip>
                )}
              </li>
            ))}
          </ol>
        )}

        {canEdit ? (
          <ActionForm action={addIssue} className="flex flex-col gap-1.5">
            <input type="hidden" name="cycleId" value={cycleId} />
            <div className="flex items-center gap-1.5">
              <label className="sr-only" htmlFor="new-issue">
                The issue
              </label>
              <input
                id="new-issue"
                name="text"
                required
                maxLength={500}
                placeholder="What is standing between us and the strategy?"
                className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
              />
              <label className="sr-only" htmlFor="new-issue-impact">
                Impact
              </label>
              <select
                id="new-issue-impact"
                name="impact"
                defaultValue="3"
                className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    Impact {value}
                  </option>
                ))}
              </select>
              <Button type="submit">Add</Button>
            </div>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
