"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DateInput,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  archiveCycle,
  type CycleResult,
  createCycle,
  updateCycleDates,
} from "./admin-actions.ts";

/**
 * Reaching the next quarter (P6-G27b).
 *
 * **`cycles.create`, `cycles.update` and `cycles.archive` all shipped and none
 * had a browser caller**, so a workspace could plan exactly one cycle: the one
 * provisioning made. The empty state on this screen said "an administrator can
 * create one from the rhythm settings", which was not true of any screen.
 *
 * **The date is a day inside the period, not the period's start.** That is the
 * action's own contract and it is the friendlier input: somebody who wants next
 * quarter picks a day in next quarter rather than working out which Monday the
 * cadence starts on.
 *
 * **Archiving is offered beside creating, because they are one decision.** A
 * workspace moving to the next cycle is closing the one it is in, and putting
 * the two in different places is how a workspace ends up with two open cycles.
 *
 * **It creates a cycle in the horizon the reader is looking at** (completeness
 * review M-06). The header's mode toggle already asks "annual or quarterly",
 * so a second picker here would ask it twice. Before this the create always
 * made the quarter, and no screen could make the annual cycle §2.1's frame
 * lives in. **The new cycle opens once it exists**, because the reason to make
 * next quarter or next year is to start planning in it, and the page would
 * otherwise go on showing the one containing today.
 */
export function CycleAdmin({
  mode,
  currentCycleId,
  currentName,
  publicationDeadline,
}: {
  readonly mode: "annual" | "quarterly";
  readonly currentCycleId: string | null;
  readonly currentName: string | null;
  readonly publicationDeadline: string | null;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  // Which button started the write in flight, so only that one spins.
  const [acting, setActing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A refusal about one of the two dates, shown under it (guided-inputs §4.2).
  const [refused, setRefused] = useState<Readonly<Record<string, string>>>({});
  const [on, setOn] = useState("");
  const [deadline, setDeadline] = useState(publicationDeadline ?? "");

  const run = (name: string, work: () => Promise<CycleResult>) => {
    setProblem(null);
    setRefused({});
    setActing(name);
    start(async () => {
      const result = await work();
      if (result.error || result.fields) {
        setProblem(result.error);
        setRefused(result.fields ?? {});
        return;
      }
      if (result.id) {
        router.push(`/cycle?cycle=${result.id}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card id="cycle-admin">
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("cycle.admin.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("cycle.admin.explains")}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1 text-xs text-ink-3">
          {mode === "annual"
            ? t("cycle.admin.createAnnualLabel")
            : t("cycle.admin.createLabel")}
          <div className="flex flex-wrap items-center gap-2.5">
            <DateInput
              label={t("cycle.admin.createDate")}
              hideLabel
              value={on}
              disabled={pending}
              error={refused.on}
              onValueChange={(next) => setOn(next ?? "")}
              inputClassName="h-auto px-2 py-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={pending || on === ""}
              pending={pending && acting === "create"}
              data-testid="create-cycle"
              onClick={() => run("create", () => createCycle({ on, mode }))}
            >
              {t("cycle.admin.create")}
            </Button>
          </div>
          <span className="text-ink-4">
            {mode === "annual"
              ? t("cycle.admin.createAnnualHelp")
              : t("cycle.admin.createHelp")}
          </span>
        </div>

        {currentCycleId ? (
          <>
            <div className="flex flex-col gap-1 text-xs text-ink-3">
              <span aria-hidden="true">{t("cycle.admin.deadlineLabel")}</span>
              <div className="flex flex-wrap items-center gap-2.5">
                {/* The kit's date, which change 7a's list missed. */}
                <DateInput
                  label={t("cycle.admin.deadlineField")}
                  hideLabel
                  value={deadline === "" ? null : deadline}
                  disabled={pending}
                  error={refused.publicationDeadline}
                  onValueChange={(next) => setDeadline(next ?? "")}
                  inputClassName="h-6.5 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  pending={pending && acting === "deadline"}
                  data-testid="set-publication-deadline"
                  onClick={() =>
                    run("deadline", () =>
                      updateCycleDates({
                        id: currentCycleId,
                        publicationDeadline: deadline === "" ? null : deadline,
                      }),
                    )
                  }
                >
                  {t("common.save")}
                </Button>
              </div>
              <span className="text-ink-4">
                {t("cycle.admin.deadlineHelp")}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-ink-3">
                {t("common.archive2", { currentName: currentName ?? "" })}
              </span>
              <div>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  pending={pending && acting === "archive"}
                  className="text-bad"
                  data-testid="archive-cycle"
                  onClick={() => {
                    // Archiving is not undone from any screen (UAT BUG-023),
                    // so it asks once, naming what is being archived.
                    if (
                      !window.confirm(
                        t("cycle.admin.archiveConfirm", {
                          name: currentName ?? "",
                        }),
                      )
                    ) {
                      return;
                    }
                    run("archive", () => archiveCycle({ id: currentCycleId }));
                  }}
                >
                  {t("common.archive")}
                </Button>
              </div>
              <span className="text-xs text-ink-4">
                {t("cycle.admin.archiveHelp")}
              </span>
            </div>
          </>
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
