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
import type { KpiOption } from "../../../lib/kpi-options.ts";
import {
  linkKeyResultKpi,
  moveGoalToCycle,
  unlinkKeyResultKpi,
} from "./write-actions.ts";

/**
 * The three goal writes that had no browser caller, and the delete (P6-G27).
 *
 * `goals.moveToCycle`, `goals.unlinkKpi` and `goals.delete` all shipped with
 * the goal and none of them could be reached from a screen, which the gap
 * audit recorded in §5. `goals.reviewDecision` is a read and is shown by the
 * page itself rather than here. Linking a KPI sits beside unlinking one since
 * completeness review M-07: the drafting step can name a KPI for a new key
 * result, and this is where one measured by hand gets one later.
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
  unlinkedKeyResults,
  kpis,
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
  /**
   * Key results measured by hand, which is what can be linked (M-07). Empty
   * when the reader cannot edit the goal or it is closed, so the control is
   * not offered to somebody the server would refuse.
   */
  readonly unlinkedKeyResults: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  /** What they can be linked to. Null when the list could not be read. */
  readonly kpis: readonly KpiOption[] | null;
  readonly canAdminister: boolean;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [target, setTarget] = useState(currentCycleId ?? "");
  const [pickedKeyResult, setPickedKeyResult] = useState(
    unlinkedKeyResults[0]?.id ?? "",
  );
  const [pickedKpi, setPickedKpi] = useState(kpis?.[0]?.id ?? "");
  // Read through the current lists, because a successful link refreshes them:
  // the key result just linked leaves this list, and a choice still pointing
  // at it would send a link the server refuses.
  const linking = unlinkedKeyResults.some((row) => row.id === pickedKeyResult)
    ? pickedKeyResult
    : (unlinkedKeyResults[0]?.id ?? "");
  const kpiId = kpis?.some((kpi) => kpi.id === pickedKpi)
    ? pickedKpi
    : (kpis?.[0]?.id ?? "");

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

        {unlinkedKeyResults.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-ink-3">
              {t("goal.writes.linkLabel")}
            </span>
            {kpis === null ? (
              <span role="status" className="text-xs text-warn">
                {t("goal.writes.kpisUnavailable")}
              </span>
            ) : kpis.length === 0 ? (
              <span className="text-xs text-ink-4">
                {t("goal.writes.noKpisYet")}{" "}
                <a className="underline" href="/kpis">
                  {t("goal.writes.addAKpi")}
                </a>
              </span>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={linking}
                    disabled={pending}
                    aria-label={t("goal.writes.linkKeyResult")}
                    onChange={(event) => setPickedKeyResult(event.target.value)}
                    className="max-w-64 rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
                  >
                    {unlinkedKeyResults.map((keyResult) => (
                      <option key={keyResult.id} value={keyResult.id}>
                        {keyResult.title}
                      </option>
                    ))}
                  </select>
                  <select
                    value={kpiId}
                    disabled={pending}
                    aria-label={t("goal.writes.linkKpi")}
                    onChange={(event) => setPickedKpi(event.target.value)}
                    className="max-w-64 rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
                  >
                    {kpis.map((kpi) => (
                      <option key={kpi.id} value={kpi.id}>
                        {kpi.unit ? `${kpi.title} (${kpi.unit})` : kpi.title}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending || linking === "" || kpiId === ""}
                    data-testid="link-kpi"
                    onClick={() =>
                      run(() => linkKeyResultKpi({ id: linking, kpiId }))
                    }
                  >
                    {t("goal.writes.link")}
                  </Button>
                </div>
                <span className="text-xs text-ink-4">
                  {t("goal.writes.linkHelp")}
                </span>
              </>
            )}
          </div>
        ) : null}

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
          <DeleteControl subject="goal" id={goalId} returnTo="/goals" />
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
