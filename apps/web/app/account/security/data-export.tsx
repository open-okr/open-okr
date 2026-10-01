"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
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
        <h2 className="text-sm font-bold text-ink">
          {t("account.security.data.title")}
        </h2>
      </CardHeader>
      <CardBody className="flex flex-col items-start gap-2.5">
        <p className="text-sm text-ink-2">
          {t("account.security.data.explains")}
        </p>
        <Button disabled={pending} onClick={download} variant="default">
          {pending
            ? t("account.security.data.preparing")
            : t("account.security.data.download")}
        </Button>
        {problem ? (
          <p className="text-bad text-sm" role="alert">
            {problem}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
