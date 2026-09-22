"use client";

import { Button } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, fieldInputClass } from "../../(auth)/auth-card";

/**
 * SSO connection creation form (P8-T07, extended at P8-T07c-b).
 *
 * A workspace administrator fills in the provider's details. An OIDC client
 * secret is sent once and stored envelope-encrypted; it is never returned to
 * the browser afterwards.
 *
 * **One form, two protocols, and only one set of fields on screen at a time.**
 * A SAML provider has no client secret and an OIDC provider has no signing
 * certificate, so showing both at once would mean half the form is always
 * wrong. The protocol is the first thing asked because it decides everything
 * under it.
 *
 * **The refusal lands on the field it is about.** The endpoint answers with
 * the field name, which is the same answer `validateSSOConnectionInput`
 * gives the server, so the browser cannot disagree with the instance about
 * what is wrong.
 */
export function SSOForm() {
  const router = useRouter();
  const [kind, setKind] = useState<"oidc" | "saml">("oidc");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const [success, setSuccess] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setField("");
    setSuccess("");
    setPending(true);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/admin/sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          providerId: form.get("providerId"),
          displayName: form.get("displayName"),
          discoveryUrl: form.get("discoveryUrl") || undefined,
          authorizationUrl: form.get("authorizationUrl") || undefined,
          tokenUrl: form.get("tokenUrl") || undefined,
          userInfoUrl: form.get("userInfoUrl") || undefined,
          clientId: form.get("clientId"),
          clientSecret: form.get("clientSecret"),
          scopes: form.get("scopes") || "openid email profile",
          samlEntryPoint: form.get("samlEntryPoint") || undefined,
          samlIssuer: form.get("samlIssuer") || undefined,
          samlCertificate: form.get("samlCertificate") || undefined,
          samlAudience: form.get("samlAudience") || undefined,
          emailDomains: form.get("emailDomains") || "",
          enforce: form.get("enforce") === "on",
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          field?: string;
        };
        setError(body.error || `Failed to save (${response.status})`);
        setField(body.field ?? "");
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

  /** The refusal, under the field it is about, or nothing. */
  const problem = (name: string) =>
    field === name ? (
      <p className="text-sm text-red-600" role="alert">
        {error}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="field-kind" className="text-sm font-medium text-ink-2">
          Protocol
        </label>
        <select
          id="field-kind"
          name="kind"
          className={fieldInputClass}
          value={kind}
          onChange={(event) =>
            setKind(event.target.value === "saml" ? "saml" : "oidc")
          }
        >
          <option value="oidc">OIDC (OpenID Connect)</option>
          <option value="saml">SAML 2.0</option>
        </select>
      </div>

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
      {problem("providerId")}
      {problem("displayName")}

      {kind === "oidc" ? (
        <>
          <Field
            label="Discovery URL (OIDC)"
            name="discoveryUrl"
            placeholder="https://login.example.com/.well-known/openid-configuration"
            type="url"
          />
          {problem("discoveryUrl")}

          <p className="text-xs text-ink-3">
            If a discovery URL is set, authorization, token and user info
            endpoints are fetched from it automatically. Fill in the fields
            below only if your provider does not support discovery.
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
          {problem("clientId")}
          {problem("clientSecret")}

          <Field
            label="Scopes"
            name="scopes"
            placeholder="openid email profile"
          />
        </>
      ) : (
        <>
          <Field
            label="Sign-on URL"
            name="samlEntryPoint"
            type="url"
            placeholder="https://login.example.com/app/sso/saml"
            required
          />
          {problem("samlEntryPoint")}

          <Field
            label="Issuer (the provider's entity ID)"
            name="samlIssuer"
            placeholder="http://www.example.com/exk1fc..."
            required
          />
          {problem("samlIssuer")}

          <div className="flex flex-col gap-1">
            <label
              htmlFor="field-samlCertificate"
              className="text-sm font-medium text-ink-2"
            >
              Signing certificate
            </label>
            <textarea
              id="field-samlCertificate"
              name="samlCertificate"
              rows={5}
              required
              className={`${fieldInputClass} h-auto py-2 font-mono text-xs`}
              placeholder="-----BEGIN CERTIFICATE-----"
            />
          </div>
          {problem("samlCertificate")}

          <p className="text-xs text-ink-3">
            Paste the certificate your identity provider publishes, with or
            without its BEGIN CERTIFICATE header. Assertions signed by any other
            key are refused. This instance's entity ID, reply URL and metadata
            document appear beside the connection once it is saved.
          </p>

          <Field
            label="Audience (optional)"
            name="samlAudience"
            placeholder="Leave empty to use this instance's URL"
          />
        </>
      )}

      <Field
        label="Email domains (comma-separated)"
        name="emailDomains"
        placeholder="acme.com, acme.org"
      />
      {problem("emailDomains")}

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="enforce" className="rounded" />
        Enforce SSO for the email domains listed above
      </label>
      <p className="text-sm text-ink-3">
        Enforcing refuses a password, a reset link and a passkey for every
        address on those domains, including your own. List at least one domain:
        enforcing with the field empty does nothing, because an empty list would
        otherwise claim every address on this instance. To undo an enforcement
        that locked you out, clear <code>enforce</code> on the row in{" "}
        <code>sso_connections</code>.
      </p>

      {error && !field && (
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
