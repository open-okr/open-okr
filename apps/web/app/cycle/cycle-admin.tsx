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
import {
  archiveCycle,
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
 */
export function CycleAdmin({
  currentCycleId,
  currentName,
  publicationDeadline,
}: {
  readonly currentCycleId: string | null;
  readonly currentName: string | null;
  readonly publicationDeadline: string | null;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [on, setOn] = useState("");
  const [deadline, setDeadline] = useState(publicationDeadline ?? "");

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
            {t("cycle.admin.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("cycle.admin.explains")}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          {t("cycle.admin.createLabel")}
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="date"
              value={on}
              disabled={pending}
              aria-label={t("cycle.admin.createDate")}
              onChange={(event) => setOn(event.target.value)}
              className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
            />
            <Button
              type="button"
              size="sm"
              disabled={pending || on === ""}
              data-testid="create-cycle"
              onClick={() => run(() => createCycle({ on }))}
            >
              {t("cycle.admin.create")}
            </Button>
          </div>
          <span className="text-ink-4">{t("cycle.admin.createHelp")}</span>
        </label>

        {currentCycleId ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("cycle.admin.deadlineLabel")}
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  type="date"
                  value={deadline}
                  disabled={pending}
                  aria-label={t("cycle.admin.deadlineField")}
                  onChange={(event) => setDeadline(event.target.value)}
                  className="rounded-md border border-line bg-bg px-2 py-1 text-xs text-ink"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  data-testid="set-publication-deadline"
                  onClick={() =>
                    run(() =>
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
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-ink-3">
                {t("common.archive")} {currentName ?? ""}
              </span>
              <div>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  className="text-bad"
                  data-testid="archive-cycle"
                  onClick={() =>
                    run(() => archiveCycle({ id: currentCycleId }))
                  }
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
