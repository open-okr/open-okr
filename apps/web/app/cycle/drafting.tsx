import { Bar, Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { ActionForm } from "./action-form.tsx";
import { addKeyResult, createGoal, recordValue } from "./goal-actions.ts";

/**
 * Phase 4's drafting surface (UIUX-PLAN.md §4 S-09, P3-T04).
 *
 * The objective and its key results, editable where they are read. The quality
 * coaching that makes S-09 "the most coached screen in the product" is P4-T02:
 * the twenty-six checks and the live verdicts need the engine at P4-T01, and a
 * screen that invented its own advice would be inventing method. What is real
 * here is the object: a goal with a champion, a reviewer and key results that
 * carry a baseline, a target and a direction.
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

export function Drafting({
  cycleId,
  goals,
  members,
  canEdit,
}: {
  readonly cycleId: string;
  readonly goals: readonly DraftGoal[];
  readonly members: readonly { readonly id: string; readonly name: string }[];
  readonly canEdit: boolean;
}) {
  return (
    <div className="flex flex-col gap-4.5">
      {goals.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">
              Nothing drafted yet. An objective states the change; its key
              results are the proof it happened.
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
                {goal.level} · {goal.champion.name} champions it,{" "}
                {goal.reviewer.name} reviews it
              </p>
            </div>
            <span className="flex flex-none items-center gap-2">
              <Chip tone={HEALTH_TONE[goal.health] ?? "neutral"}>
                {goal.health.replace("_", " ")}
              </Chip>
              <a
                className="text-xs text-brand-600 underline"
                href={`/goals/${goal.id}`}
              >
                Open
              </a>
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Bar value={goal.progressPct} className="h-1.5 flex-1" />
              <span className="text-xs font-semibold text-ink-3">
                {Math.round(goal.progressPct)}%
              </span>
            </div>

            {goal.contributionStatement ? (
              <p className="text-xs text-ink-3">
                Contributes: {goal.contributionStatement}
              </p>
            ) : (
              <p className="text-xs text-warn">
                No parent and no contribution statement, so publish gate 3 is
                red.
              </p>
            )}

            {goal.keyResults.length === 0 ? (
              <p className="text-sm text-ink-3">
                No key results yet. Without one, nothing here is measurable.
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
                          {keyResult.baselineValue} to {keyResult.targetValue}
                          {keyResult.unit ? ` ${keyResult.unit}` : ""} · weight{" "}
                          {keyResult.weight}
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
                          New value for {keyResult.title}
                        </label>
                        <input
                          id={`value-${keyResult.id}`}
                          name="value"
                          type="number"
                          step="any"
                          required
                          placeholder="Where is it now?"
                          className="w-36 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-4"
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                        >
                          Record
                        </Button>
                      </ActionForm>
                    ) : null}
                    {keyResult.kpiId ? (
                      <p className="text-xs text-ink-3">
                        Reads its value from a KPI. Manual entry is refused
                        while the link holds.
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
                  The key result
                </label>
                <input
                  id={`kr-title-${goal.id}`}
                  name="title"
                  required
                  maxLength={500}
                  placeholder="What changes, measured how?"
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="sr-only" htmlFor={`kr-dir-${goal.id}`}>
                    Direction
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
                    Indicator
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
                    Baseline
                  </label>
                  <input
                    id={`kr-base-${goal.id}`}
                    name="baselineValue"
                    type="number"
                    step="any"
                    required
                    placeholder="Baseline"
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-4"
                  />
                  <label className="sr-only" htmlFor={`kr-target-${goal.id}`}>
                    Target
                  </label>
                  <input
                    id={`kr-target-${goal.id}`}
                    name="targetValue"
                    type="number"
                    step="any"
                    required
                    placeholder="Target"
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-4"
                  />
                  <label className="sr-only" htmlFor={`kr-unit-${goal.id}`}>
                    Unit
                  </label>
                  <input
                    id={`kr-unit-${goal.id}`}
                    name="unit"
                    maxLength={60}
                    placeholder="Unit"
                    className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink placeholder:text-ink-4"
                  />
                  <Button type="submit">Add key result</Button>
                </div>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      ))}

      {canEdit ? (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Draft an objective</h2>
          </CardHeader>
          <CardBody>
            <ActionForm action={createGoal} className="flex flex-col gap-1.5">
              <input type="hidden" name="cycleId" value={cycleId} />
              <label className="sr-only" htmlFor="goal-title">
                The objective
              </label>
              <input
                id="goal-title"
                name="title"
                required
                maxLength={500}
                placeholder="What is different at the end of this cycle?"
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
              />
              <label className="sr-only" htmlFor="goal-contribution">
                What it contributes to
              </label>
              <input
                id="goal-contribution"
                name="contributionStatement"
                maxLength={1000}
                placeholder="The priority this moves forward"
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-4"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="sr-only" htmlFor="goal-level">
                  Level
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
                  Champion
                </label>
                <select
                  id="goal-champion"
                  name="championId"
                  required
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      Champion: {member.name}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="goal-reviewer">
                  Reviewer
                </label>
                <select
                  id="goal-reviewer"
                  name="reviewerId"
                  required
                  className="rounded-md border border-line bg-surface px-1.5 py-1.5 text-xs text-ink-2"
                >
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      Reviewer: {member.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="primary">
                  Add objective
                </Button>
              </div>
              <p className="text-xs text-ink-3">
                METHOD.md §2.5 asks for one champion and one reviewer, and
                prefers two different people. One person can hold both where a
                team has nobody else.
              </p>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
