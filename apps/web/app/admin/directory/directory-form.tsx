"use client";

import { Button } from "@openokr/ui";
import { useState } from "react";

/**
 * SCIM token generation form (P8-T08).
 *
 * Generates a bearer token, shows it once, and never again. The identity
 * provider copies it into its SCIM configuration.
 */
export function DirectoryTokenForm() {
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
            `Failed to generate token (${response.status})`,
        );
      } else {
        const data = (await response.json()) as { token: string };
        setToken(data.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
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
    <div className="flex flex-col gap-3">
      {token ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-800">
            Copy this token now. It will not be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs text-ink break-all">
              {token}
            </code>
            <Button type="button" variant="default" onClick={copyToClipboard}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-amber-700">
            Any previous SCIM token for this workspace has been revoked.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={generate}
          >
            {pending ? "Generating..." : "Generate SCIM token"}
          </Button>
          <p className="text-xs text-ink-3">
            This replaces any existing token for this workspace.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
