"use client";

/**
 * The workspace archive import card (UIUX-PLAN.md SS6 S-36, P6-T05c).
 *
 * Three stages in one card: upload, dry-run review, confirm. The archive
 * base64 stays in React state between stages so the dry-run and the real
 * import use the same bytes. The dry-run difference MUST be shown before the
 * confirm button appears.
 */

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { useCallback, useState, useTransition } from "react";
import { type ImportResult, importWorkspaceArchive } from "./actions.ts";

type Stage = "idle" | "analyzing" | "preview" | "importing" | "done";

export function ArchiveImportCard() {
  const { t } = useTranslations();

  const [stage, setStage] = useState<Stage>("idle");
  const [pending, startTransition] = useTransition();
  const [archiveBase64, setArchiveBase64] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);
      setPreview(null);
      setResult(null);
      setStage("analyzing");

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1] ?? "";
        setArchiveBase64(base64);

        startTransition(async () => {
          const answer = await importWorkspaceArchive(base64, true);
          if (!answer.ok) {
            setError(answer.error);
            setStage("idle");
            return;
          }
          setPreview(answer.value);
          setStage("preview");
        });
      };
      reader.onerror = () => {
        setError("Could not read the file.");
        setStage("idle");
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    if (!archiveBase64) return;
    setError(null);
    setStage("importing");

    startTransition(async () => {
      const answer = await importWorkspaceArchive(archiveBase64, false);
      if (!answer.ok) {
        setError(answer.error);
        setStage("preview");
        return;
      }
      setResult(answer.value);
      setStage("done");
    });
  }, [archiveBase64]);

  const handleReset = useCallback(() => {
    setStage("idle");
    setArchiveBase64(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }, []);

  const totalCreated = (diff: ImportResult["difference"]) =>
    Object.values(diff.created).reduce((sum, n) => sum + n, 0);
  const totalSkipped = (diff: ImportResult["difference"]) =>
    Object.values(diff.skipped).reduce((sum, n) => sum + n, 0);

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-bold text-ink">
          {t("admin.imports.archiveImportCard.importWorkspaceArchive")}
        </h3>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-3">
          {t("admin.imports.archiveImportCard.uploadAn")}{" "}
          <code>{t("admin.imports.archiveImportCard.okr")}</code>{" "}
          {t("admin.imports.archiveImportCard.archiveExportedFromAnother")}
        </p>

        {/* Stage: idle or analyzing */}
        {(stage === "idle" || stage === "analyzing") && (
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".okr"
              onChange={handleFileChange}
              disabled={pending}
              className="text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-2.5 file:py-1.5 file:text-xs file:font-semibold file:text-on-brand"
            />
            {stage === "analyzing" && (
              <span className="text-sm text-ink-3">
                {t("admin.imports.archiveImportCard.analyzingArchive")}
              </span>
            )}
          </div>
        )}

        {/* Stage: preview (dry-run result) */}
        {stage === "preview" && preview && (
          <div className="flex flex-col gap-3">
            {preview.alreadyImported ? (
              <div className="rounded-md border border-line bg-bg-2 px-3 py-2">
                <p className="text-sm font-medium text-ink">
                  {t("admin.imports.archiveImportCard.thisArchiveWasAlready")}
                </p>
                <p className="text-xs text-ink-3">
                  {t("admin.imports.archiveImportCard.theStoredReportFrom")}
                </p>
              </div>
            ) : null}

            <h4 className="text-xs font-semibold text-ink-3">
              {preview.alreadyImported
                ? "Previous import result"
                : "Preview: what this import will do"}
            </h4>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">
                {t("admin.imports.archiveImportCard.rowsToCreate")}
              </dt>
              <dd className="text-ink">{totalCreated(preview.difference)}</dd>
              <dt className="text-ink-3">
                {t("admin.imports.archiveImportCard.rowsToSkip")}
              </dt>
              <dd className="text-ink">{totalSkipped(preview.difference)}</dd>
              <dt className="text-ink-3">{t("attachments.title")}</dt>
              <dd className="text-ink">{preview.difference.blobs}</dd>
            </dl>

            {/* Tables breakdown */}
            {Object.keys(preview.difference.created).length > 0 && (
              <details className="text-xs text-ink-3">
                <summary className="cursor-pointer font-semibold">
                  {t("admin.imports.archiveImportCard.tables")}
                  {Object.keys(preview.difference.created).length})
                </summary>
                <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                  {Object.entries(preview.difference.created).map(
                    ([table, count]) => (
                      <li key={table}>
                        {table}: {count}{" "}
                        {t("admin.imports.archiveImportCard.rowS")}
                      </li>
                    ),
                  )}
                </ul>
              </details>
            )}

            {/* Members to merge */}
            {preview.difference.merged.length > 0 && (
              <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2">
                <p className="text-xs font-semibold text-warn">
                  {preview.difference.merged.length}{" "}
                  {t("admin.imports.archiveImportCard.memberSWillMerge")}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-ink-2">
                  {preview.difference.merged.map((m) => (
                    <li key={m.archivedId}>
                      {m.name} ({m.email})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              {!preview.alreadyImported && (
                <Button
                  variant="primary"
                  onClick={handleConfirm}
                  disabled={pending}
                >
                  {pending ? "Importing..." : "Confirm import"}
                </Button>
              )}
              <Button variant="ghost" onClick={handleReset}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}

        {/* Stage: done */}
        {stage === "done" && result && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Chip tone="ok">
                {t("admin.imports.archiveImportCard.imported")}
              </Chip>
              <span className="text-sm text-ink">
                {totalCreated(result.difference)}{" "}
                {t("admin.imports.archiveImportCard.rowsCreated")}{" "}
                {totalSkipped(result.difference)} {t("admin.imports.skipped")}
                {result.difference.merged.length > 0
                  ? `, ${result.difference.merged.length} member(s) merged`
                  : ""}
              </span>
            </div>
            <Button variant="ghost" onClick={handleReset}>
              {t("admin.imports.archiveImportCard.importAnother")}
            </Button>
          </div>
        )}

        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
