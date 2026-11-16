"use client";

import { Button, CardBody, CopyField, useTranslations } from "@openokr/ui";
import { useEffect, useState } from "react";

/**
 * SCIM token generation form (P8-T08).
 *
 * Generates a bearer token, shows it once, and never again. The identity
 * provider copies it into its SCIM configuration.
 */
export function DirectoryTokenForm({
  scimPath,
}: {
  readonly scimPath: string;
}) {
  const { t } = useTranslations();
  // The origin is only known in the browser, so the server render shows the
  // path and the full URL replaces it once mounted.
  const [endpoint, setEndpoint] = useState(scimPath);
  useEffect(() => {
    setEndpoint(`${window.location.origin}${scimPath}`);
  }, [scimPath]);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setError("");
    setToken(null);
    setPending(true);
    setCopied(false);

    try {
      const response = await fetch("/api/v1/admin/directory/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "SCIM token" }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(
          (body as { error?: string }).error ||
            t("admin.directory.directoryForm.failedToGenerate", {
              status: response.status,
            }),
        );
      } else {
        const data = (await response.json()) as { token: string };
        setToken(data.token);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("admin.directory.directoryForm.networkError"),
      );
    } finally {
      setPending(false);
    }
  };

  const copyToClipboard = async () => {
    if (token) {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <CardBody>
        <div className="grid grid-cols-12 gap-x-6 gap-y-4">
          <CopyField
            className="col-span-12"
            label={t("admin.directory.scimEndpoint")}
            copyLabel={t("admin.directory.directoryForm.copyEndpoint")}
            value={endpoint}
          />

          {token ? (
            <div className="col-span-12 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">
                {t("admin.directory.directoryForm.copyThisTokenNow")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code
                  data-testid="scim-token"
                  className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs text-ink break-all"
                >
                  {token}
                </code>
                <Button
                  type="button"
                  variant="default"
                  onClick={copyToClipboard}
                >
                  {copied
                    ? t("admin.directory.directoryForm.copied")
                    : t("admin.directory.directoryForm.copy")}
                </Button>
              </div>
              <p className="mt-2 text-xs text-amber-700">
                {t("admin.directory.directoryForm.previousTokenRevoked")}
              </p>
            </div>
          ) : null}

          {error && (
            <p className="col-span-12 text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>
      </CardBody>

      {token ? null : (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
          <p className="text-sm text-ink-3">
            {t("admin.directory.directoryForm.replacesExistingToken")}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            pending={pending}
            onClick={generate}
          >
            {pending
              ? t("admin.directory.directoryForm.generating")
              : t("admin.directory.directoryForm.generateScimToken")}
          </Button>
        </div>
      )}
    </>
  );
}
