"use client";

import { Button, useTranslations } from "@openokr/ui";
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
  const { t } = useTranslations();
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
        setError(
          body.error ||
            t("admin.sso.ssoForm.failedToSave", { status: response.status }),
        );
        setField(body.field ?? "");
      } else {
        setSuccess(t("admin.sso.ssoForm.providerSaved"));
        (event.target as HTMLFormElement).reset();
        router.refresh();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("admin.sso.ssoForm.networkError"),
      );
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
          {t("admin.sso.ssoForm.protocol")}
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
          <option value="oidc">
            {t("admin.sso.ssoForm.oidcOpenIdConnect")}
          </option>
          <option value="saml">{t("admin.sso.saml2")}</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label={t("admin.sso.ssoForm.providerId")}
          name="providerId"
          placeholder={t("admin.sso.ssoForm.providerIdPlaceholder")}
          required
        />
        <Field
          label={t("admin.sso.ssoForm.displayName")}
          name="displayName"
          placeholder={t("admin.sso.ssoForm.displayNamePlaceholder")}
          required
        />
      </div>
      {problem("providerId")}
      {problem("displayName")}

      {kind === "oidc" ? (
        <>
          <Field
            label={t("admin.sso.ssoForm.discoveryUrl")}
            name="discoveryUrl"
            placeholder={t("admin.sso.ssoForm.discoveryUrlPlaceholder")}
            type="url"
          />
          {problem("discoveryUrl")}

          <p className="text-xs text-ink-3">
            {t("admin.sso.ssoForm.ifADiscoveryUrlIsSet")}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field
              label={t("admin.sso.ssoForm.authorizationUrl")}
              name="authorizationUrl"
              type="url"
              placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
            />
            <Field
              label={t("admin.sso.ssoForm.tokenUrl")}
              name="tokenUrl"
              type="url"
              placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
            />
            <Field
              label={t("admin.sso.ssoForm.userInfoUrl")}
              name="userInfoUrl"
              type="url"
              placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={t("admin.sso.ssoForm.clientId")}
              name="clientId"
              required
            />
            <Field
              label={t("admin.sso.ssoForm.clientSecret")}
              name="clientSecret"
              type="password"
              required
              autoComplete="off"
            />
          </div>
          {problem("clientId")}
          {problem("clientSecret")}

          <Field
            label={t("account.apiTokens.scopes")}
            name="scopes"
            placeholder={t("admin.sso.ssoForm.scopesPlaceholder")}
          />
        </>
      ) : (
        <>
          <Field
            label={t("admin.sso.ssoForm.signOnUrl")}
            name="samlEntryPoint"
            type="url"
            placeholder={t("admin.sso.ssoForm.signOnUrlPlaceholder")}
            required
          />
          {problem("samlEntryPoint")}

          <Field
            label={t("admin.sso.ssoForm.issuer")}
            name="samlIssuer"
            placeholder={t("admin.sso.ssoForm.issuerPlaceholder")}
            required
          />
          {problem("samlIssuer")}

          <div className="flex flex-col gap-1">
            <label
              htmlFor="field-samlCertificate"
              className="text-sm font-medium text-ink-2"
            >
              {t("admin.sso.ssoForm.signingCertificate")}
            </label>
            <textarea
              id="field-samlCertificate"
              name="samlCertificate"
              rows={5}
              required
              className={`${fieldInputClass} h-auto py-2 font-mono text-xs`}
              placeholder={t("admin.sso.ssoForm.certificatePlaceholder")}
            />
          </div>
          {problem("samlCertificate")}

          <p className="text-xs text-ink-3">
            {t("admin.sso.ssoForm.pasteTheCertificate")}
          </p>

          <Field
            label={t("admin.sso.ssoForm.audienceOptional")}
            name="samlAudience"
            placeholder={t("admin.sso.ssoForm.leaveEmptyToUseThisInstancesUrl")}
          />
        </>
      )}

      <Field
        label={t("admin.sso.ssoForm.emailDomains")}
        name="emailDomains"
        placeholder={t("admin.sso.ssoForm.emailDomainsPlaceholder")}
      />
      {problem("emailDomains")}

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" name="enforce" className="rounded" />
        {t("admin.sso.ssoForm.enforceSsoForTheEmailDomains")}
      </label>
      <p className="text-sm text-ink-3">
        {t("admin.sso.ssoForm.enforcingRefusesAPassword", {
          column: "enforce",
          table: "sso_connections",
        })}
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
        {pending ? t("admin.sso.ssoForm.saving") : t("admin.sso.addProvider")}
      </Button>
    </form>
  );
}
