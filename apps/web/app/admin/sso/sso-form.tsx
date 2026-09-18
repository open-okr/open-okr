"use client";

import { Button } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "../../(auth)/auth-card";

/**
 * SSO connection creation form (P8-T07).
 *
 * A workspace administrator fills in the OIDC provider details. The client
 * secret is sent once and stored envelope-encrypted. It is never returned
 * to the browser after creation.
 */
export function SSOForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setPending(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/admin/sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: form.get("providerId"),
          displayName: form.get("displayName"),
          discoveryUrl: form.get("discoveryUrl") || undefined,
          authorizationUrl: form.get("authorizationUrl") || undefined,
          tokenUrl: form.get("tokenUrl") || undefined,
          userInfoUrl: form.get("userInfoUrl") || undefined,
          clientId: form.get("clientId"),
          clientSecret: form.get("clientSecret"),
          scopes: form.get("scopes") || "openid email profile",
          emailDomains: form.get("emailDomains") || "",
          enforce: form.get("enforce") === "on",
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(
          (body as { error?: string }).error ||
            `Failed to save (${response.status})`,
        );
      } else {
        setSuccess(
          "Provider saved. It will take effect on the next instance restart.",
        );
        (event.target as HTMLFormElement).reset();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Provider ID"
          name="providerId"
          placeholder="okta"
          required
        />
        <Field
          label="Display name"
          name="displayName"
          placeholder="Sign in with Okta"
          required
        />
      </div>

      <Field
        label="Discovery URL (OIDC)"
        name="discoveryUrl"
        placeholder="https://login.example.com/.well-known/openid-configuration"
        type="url"
      />

      <p className="text-xs text-ink-3">
        If a discovery URL is set, authorization, token and user info endpoints
        are fetched from it automatically. Fill in the fields below only if your
        provider does not support discovery.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field
          label="Authorization URL"
          name="authorizationUrl"
          type="url"
          placeholder="https://..."
        />
        <Field
          label="Token URL"
          name="tokenUrl"
          type="url"
          placeholder="https://..."
        />
        <Field
          label="User info URL"
          name="userInfoUrl"
          type="url"
          placeholder="https://..."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Client ID" name="clientId" required />
        <Field
          label="Client secret"
          name="clientSecret"
          type="password"
          required
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Scopes"
          name="scopes"
          placeholder="openid email profile"
        />
        <Field
          label="Email domains (comma-separated)"
          name="emailDomains"
          placeholder="acme.com, acme.org"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="enforce" className="rounded" />
        Enforce SSO for matching email domains (disables password sign-in)
      </label>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-emerald-600" role="status">
          {success}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Saving..." : "Add provider"}
      </Button>
    </form>
  );
}
