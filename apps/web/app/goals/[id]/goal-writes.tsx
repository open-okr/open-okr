"use client";

import {
  Button,
  Card,
  CardBody,
  EntityPicker,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DeleteControl } from "../../../lib/delete-control.tsx";
import { namedOption } from "../../../lib/entity-options.ts";
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
      {/* Closed until asked for: the goal page is read every week, and moving,
          linking or deleting a goal happens once (OKRGoal UX review, N6). */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 group-open:border-b group-open:border-line">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-bold text-ink">
              {t("goal.writes.title")}
            </span>
            <span className="text-xs text-ink-3">
              {t("goal.writes.explains")}
            </span>
          </span>
          <span aria-hidden className="text-xs text-ink-3 group-open:rotate-90">
            ›
          </span>
        </summary>
        <CardBody className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1 text-xs text-ink-3">
            {t("goal.writes.moveLabel")}
            <div className="flex flex-wrap items-center gap-2.5">
              <EntityPicker
                label={t("goal.writes.moveTarget")}
                hideLabel
                value={target === "" ? null : target}
                options={cycles.map(namedOption)}
                disabled={pending}
                onValueChange={(next) => setTarget(next ?? "")}
                className="w-56"
                inputClassName="text-xs"
              />
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
          </div>

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
                    <EntityPicker
                      label={t("goal.writes.linkKeyResult")}
                      hideLabel
                      value={linking === "" ? null : linking}
                      options={unlinkedKeyResults.map((keyResult) => ({
                        id: keyResult.id,
                        label: keyResult.title,
                      }))}
                      disabled={pending}
                      onValueChange={(next) => setPickedKeyResult(next ?? "")}
                      className="w-64"
                      inputClassName="text-xs"
                    />
                    <EntityPicker
                      label={t("goal.writes.linkKpi")}
                      hideLabel
                      value={kpiId === "" ? null : kpiId}
                      options={kpis.map((kpi) => ({
                        id: kpi.id,
                        label: kpi.title,
                        detail: kpi.unit
                          ? `${kpi.shortId} · ${kpi.unit}`
                          : kpi.shortId,
                      }))}
                      disabled={pending}
                      onValueChange={(next) => setPickedKpi(next ?? "")}
                      className="w-64"
                      inputClassName="text-xs"
                    />
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
              <span className="text-xs text-ink-4">
                {t("common.unlinkHelp")}
              </span>
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
      </details>
    </Card>
  );
}
