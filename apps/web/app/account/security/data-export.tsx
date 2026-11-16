"use client";

import { Button, Card, CardHeader, useTranslations } from "@openokr/ui";
import { useState, useTransition } from "react";
import { exportMyData } from "./data-actions";

/**
 * "Your data" on the security screen (completeness review M-18).
 *
 * The personal export used to exist only inside erasure. A person can now
 * take the same document whenever they like, without anybody else being
 * asked or told.
 */
export function DataExport() {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const download = () => {
    setProblem(null);
    start(async () => {
      const result = await exportMyData();
      if (!result.json) {
        setProblem(result.error ?? t("account.security.data.failed"));
        return;
      }
      const url = URL.createObjectURL(
        new Blob([result.json], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "openokr-my-data.json";
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.security.data.title")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("account.security.data.explains")}
          </p>
        </div>
      </CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3 border-line border-t px-3.5 py-2.5">
        <div className="min-w-0 text-sm">
          {pending ? (
            <span className="text-ink-3">
              {t("account.security.data.preparing")}
            </span>
          ) : problem ? (
            <p className="text-bad text-sm" role="alert">
              {problem}
            </p>
          ) : null}
        </div>
        <Button
          pending={pending}
          onClick={download}
          variant="default"
          size="sm"
        >
          {t("account.security.data.download")}
        </Button>
      </div>
    </Card>
  );
}
