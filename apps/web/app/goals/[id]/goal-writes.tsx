"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DeleteControl } from "../../../lib/delete-control.tsx";
import { moveGoalToCycle, unlinkKeyResultKpi } from "./write-actions.ts";

/**
 * The three goal writes that had no browser caller, and the delete (P6-G27).
 *
 * `goals.moveToCycle`, `goals.unlinkKpi` and `goals.delete` all shipped with
 * the goal and none of them could be reached from a screen, which the gap
 * audit recorded in §5. `goals.reviewDecision` is a read and is shown by the
 * page itself rather than here.
 *
 * **One card, because the three belong together as "what else can happen to
 * this goal".** Moving it and deleting it are both things somebody does once,
 * deliberately, at the end of a conversation, and neither belongs beside the
 * fields somebody edits every week.
 */
export function GoalWrites({
  goalId,
  cycles,
  currentCycleId,
  linkedKeyResults,
  canAdminister,
}: {
  readonly goalId: string;
  readonly cycles: readonly { readonly id: string; readonly name: string }[];
  readonly currentCycleId: string | null;
  /** Key results whose value comes from a KPI, which is what can be unlinked. */
  readonly linkedKeyResults: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  readonly canAdminister: boolean;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [target, setTarget] = useState(currentCycleId ?? "");

  const run = (work: () => Promise<{ error: string | null }>) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (result.error) {
        setProblem(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("goal.writes.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("goal.writes.explains")}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          {t("goal.writes.moveLabel")}
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={target}
              disabled={pending}
              aria-label={t("goal.writes.moveTarget")}
              onChange={(event) => setTarget(event.target.value)}
              className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
            >
              {cycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={pending || target === "" || target === currentCycleId}
              data-testid="move-to-cycle"
              onClick={() =>
                run(() => moveGoalToCycle({ id: goalId, cycleId: target }))
              }
            >
              {t("goal.writes.move")}
            </Button>
          </div>
          <span className="text-ink-4">{t("goal.writes.moveHelp")}</span>
        </label>

        {linkedKeyResults.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-ink-3">
              {t("goal.writes.unlinkLabel")}
            </span>
            {linkedKeyResults.map((keyResult) => (
              <div
                key={keyResult.id}
                className="flex flex-wrap items-center justify-between gap-2.5"
              >
                <span className="min-w-0 text-xs text-ink-2">
                  {keyResult.title}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  data-testid={`unlink-kpi-${keyResult.id}`}
                  onClick={() =>
                    run(() => unlinkKeyResultKpi({ id: keyResult.id }))
                  }
                >
                  {t("common.unlink")}
                </Button>
              </div>
            ))}
            <span className="text-xs text-ink-4">{t("common.unlinkHelp")}</span>
          </div>
        ) : null}

        {canAdminister ? (
          <DeleteControl
            subject="goal"
            id={goalId}
            what="this goal"
            returnTo="/goals"
          />
        ) : null}

        {problem ? (
          <span role="alert" className="text-xs text-bad">
            {problem}
          </span>
        ) : null}
      </CardBody>
    </Card>
  );
}
