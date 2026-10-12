"use client";

import type { SSOConnectionDetails } from "@openokr/core";
import {
  Button,
  IdentifierInput,
  SelectInput,
  TextArea,
  TokenInput,
  UrlInput,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "../../(auth)/auth-card";
import { updateSSOConnectionAction } from "./actions";

/**
 * The single sign-on connection form, for adding one and for changing one
 * (P8-T07, extended at P8-T07c-b, and for editing since the admin screen
 * could first change a connection).
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
 * **The refusal lands on the field it is about.** The endpoint and the edit
 * action both answer with the field name, which is the same answer
 * `validateSSOConnectionInput` gives the server, so the browser cannot
 * disagree with the instance about what is wrong.
 *
 * **Editing is the same form, filled in, with three things held still.** The
 * protocol and the provider ID are shown and cannot be changed: the provider
 * ID is in the callback address the identity provider already holds, and a
 * different protocol is a different set of fields. The client secret is
 * blank, because it is never sent back, and blank on save keeps the one
 * stored. Adding still posts to `POST /api/v1/admin/sso`; saving an edit goes
 * through `sso.updateConnection`.
 */
export function SSOForm({
  connection,
  onSaved,
  onCancel,
}: {
  /** The connection being changed. Absent when adding one. */
  readonly connection?: SSOConnectionDetails;
  /** Told when an edit landed, so the row can close the form. */
  readonly onSaved?: () => void;
  readonly onCancel?: () => void;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const editing = connection !== undefined;
  const [chosenKind, setKind] = useState<"oidc" | "saml">("oidc");
  const kind = connection?.kind ?? chosenKind;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState("");
  const [success, setSuccess] = useState("");

  // Two forms can be on the screen at once while a connection is edited, so
  // an edit form's ids are its own, or its labels would name the add form's
  // inputs. The add form keeps the `field-<name>` ids it always had.
  const idFor = (name: string) =>
    connection ? `sso-${connection.id}-${name}` : `field-${name}`;

  const text = (form: FormData, name: string) =>
    String(form.get(name) ?? "").trim();

  const saveEdit = async (form: FormData, current: SSOConnectionDetails) => {
    const result = await updateSSOConnectionAction({
      id: current.id,
      kind: current.kind,
      displayName: text(form, "displayName"),
      emailDomains: text(form, "emailDomains"),
      enforce: form.get("enforce") === "on",
      clientId: text(form, "clientId"),
      // Not trimmed: a secret is whatever the provider issued. Blank keeps
      // the stored one, which the action decides rather than this form.
      clientSecret: String(form.get("clientSecret") ?? ""),
      discoveryUrl: text(form, "discoveryUrl"),
      authorizationUrl: text(form, "authorizationUrl"),
      tokenUrl: text(form, "tokenUrl"),
      userInfoUrl: text(form, "userInfoUrl"),
      scopes: text(form, "scopes"),
      samlEntryPoint: text(form, "samlEntryPoint"),
      samlIssuer: text(form, "samlIssuer"),
      samlCertificate: text(form, "samlCertificate"),
      samlAudience: text(form, "samlAudience"),
    });
    if (!result.ok) {
      setError(result.message);
      setField(result.field ?? "");
      return;
    }
    router.refresh();
    onSaved?.();
  };

  const saveNew = async (element: HTMLFormElement, form: FormData) => {
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
      return;
    }
    setSuccess(t("admin.sso.ssoForm.providerSaved"));
    element.reset();
    router.refresh();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setField("");
    setSuccess("");
    setPending(true);

    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      if (connection) {
        await saveEdit(form, connection);
      } else {
        await saveNew(element, form);
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

  /**
   * The refusal, on the field it is about, linked to it (guided-inputs
   * §4.11). Three of the four OIDC addresses had nowhere to show one.
   */
  const errorFor = (name: string) => (field === name ? error : null);

  const protocolName =
    kind === "saml"
      ? t("admin.sso.saml2")
      : t("admin.sso.ssoForm.oidcOpenIdConnect");

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3"
      aria-busy={pending}
      aria-label={
        connection
          ? t("admin.sso.ssoForm.editConnection", {
              name: connection.displayName,
            })
          : undefined
      }
    >
      {connection ? (
        <p className="text-sm text-ink-2">
          {t("admin.sso.ssoForm.protocolFixed", { protocol: protocolName })}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <SelectInput
            label={t("admin.sso.ssoForm.protocol")}
            id={idFor("kind")}
            name="kind"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value === "saml" ? "saml" : "oidc")
            }
          >
            <option value="oidc">
              {t("admin.sso.ssoForm.oidcOpenIdConnect")}
            </option>
            <option value="saml">{t("admin.sso.saml2")}</option>
          </SelectInput>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* The server's own rule as it is typed: capitals lowered, and
            anything else marked (guided-inputs §4.11). */}
        <IdentifierInput
          id={idFor("providerId")}
          label={t("admin.sso.ssoForm.providerId")}
          name="providerId"
          rule="slug"
          placeholder={t("admin.sso.ssoForm.providerIdPlaceholder")}
          defaultValue={connection?.providerId}
          readOnly={editing}
          description={
            editing ? t("admin.sso.ssoForm.providerIdFixed") : undefined
          }
          required={!editing}
          error={errorFor("providerId")}
        />
        <Field
          id={idFor("displayName")}
          label={t("admin.sso.ssoForm.displayName")}
          name="displayName"
          placeholder={t("admin.sso.ssoForm.displayNamePlaceholder")}
          defaultValue={connection?.displayName}
          required
          error={errorFor("displayName")}
        />
      </div>

      {kind === "oidc" ? (
        <>
          {/* Each a whole https address, the rule the server applies. */}
          <UrlInput
            id={idFor("discoveryUrl")}
            label={t("admin.sso.ssoForm.discoveryUrl")}
            name="discoveryUrl"
            secure
            placeholder={t("admin.sso.ssoForm.discoveryUrlPlaceholder")}
            defaultValue={connection?.discoveryUrl ?? undefined}
            error={errorFor("discoveryUrl")}
          />

          <p className="text-xs text-ink-3">
            {t("admin.sso.ssoForm.ifADiscoveryUrlIsSet")}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <UrlInput
              id={idFor("authorizationUrl")}
              label={t("admin.sso.ssoForm.authorizationUrl")}
              name="authorizationUrl"
              secure
              placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
              defaultValue={connection?.authorizationUrl ?? undefined}
              error={errorFor("authorizationUrl")}
            />
            <UrlInput
              id={idFor("tokenUrl")}
              label={t("admin.sso.ssoForm.tokenUrl")}
              name="tokenUrl"
              secure
              placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
              defaultValue={connection?.tokenUrl ?? undefined}
              error={errorFor("tokenUrl")}
            />
            <UrlInput
              id={idFor("userInfoUrl")}
              label={t("admin.sso.ssoForm.userInfoUrl")}
              name="userInfoUrl"
              secure
              placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
              defaultValue={connection?.userInfoUrl ?? undefined}
              error={errorFor("userInfoUrl")}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id={idFor("clientId")}
              label={t("admin.sso.ssoForm.clientId")}
              name="clientId"
              defaultValue={connection?.clientId ?? undefined}
              required
              error={errorFor("clientId")}
            />
            {/* Never filled in. The stored secret is sealed and stays on the
             * server; blank on an edit keeps it. */}
            <Field
              id={idFor("clientSecret")}
              label={t("admin.sso.ssoForm.clientSecret")}
              name="clientSecret"
              type="password"
              required={!editing}
              autoComplete="off"
              placeholder={
                editing ? t("admin.sso.ssoForm.leaveBlankToKeep") : undefined
              }
              error={errorFor("clientSecret")}
            />
          </div>

          {/* A chip each, posted space-separated as the provider reads
              them (guided-inputs §4.11). */}
          <TokenInput
            id={idFor("scopes")}
            label={t("account.apiTokens.scopes")}
            name="scopes"
            joiner=" "
            placeholder={t("admin.sso.ssoForm.scopesPlaceholder")}
            defaultValue={(connection?.scopes ?? "").split(" ").filter(Boolean)}
          />
        </>
      ) : (
        <>
          <UrlInput
            id={idFor("samlEntryPoint")}
            label={t("admin.sso.ssoForm.signOnUrl")}
            name="samlEntryPoint"
            placeholder={t("admin.sso.ssoForm.signOnUrlPlaceholder")}
            defaultValue={connection?.samlEntryPoint ?? undefined}
            required
            error={errorFor("samlEntryPoint")}
          />

          <Field
            id={idFor("samlIssuer")}
            label={t("admin.sso.ssoForm.issuer")}
            name="samlIssuer"
            placeholder={t("admin.sso.ssoForm.issuerPlaceholder")}
            defaultValue={connection?.samlIssuer ?? undefined}
            required
            error={errorFor("samlIssuer")}
          />

          <div className="flex flex-col gap-1">
            <TextArea
              label={t("admin.sso.ssoForm.signingCertificate")}
              id={idFor("samlCertificate")}
              name="samlCertificate"
              rows={5}
              required
              placeholder={t("admin.sso.ssoForm.certificatePlaceholder")}
              defaultValue={connection?.samlCertificate ?? undefined}
              inputClassName="font-mono text-xs"
              error={errorFor("samlCertificate")}
            />
          </div>

          <p className="text-xs text-ink-3">
            {t("admin.sso.ssoForm.pasteTheCertificate")}
          </p>

          <Field
            id={idFor("samlAudience")}
            label={t("admin.sso.ssoForm.audienceOptional")}
            name="samlAudience"
            placeholder={t("admin.sso.ssoForm.leaveEmptyToUseThisInstancesUrl")}
            defaultValue={connection?.samlAudience ?? undefined}
          />
        </>
      )}

      {/* Each a domain, on the rule the server now applies (§4.11). */}
      <TokenInput
        id={idFor("emailDomains")}
        label={t("admin.sso.ssoForm.emailDomains")}
        name="emailDomains"
        rule="domain"
        placeholder={t("admin.sso.ssoForm.emailDomainsPlaceholder")}
        defaultValue={(connection?.emailDomains ?? "")
          .split(",")
          .map((one) => one.trim())
          .filter(Boolean)}
        error={errorFor("emailDomains")}
      />

      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input
          type="checkbox"
          name="enforce"
          className="rounded"
          defaultChecked={connection?.enforce}
        />
        {t("admin.sso.ssoForm.enforceSsoForTheEmailDomains")}
      </label>
      <p className="text-sm text-ink-3">
        {t("admin.sso.ssoForm.enforcingRefusesAPassword", {
          column: "enforce",
          table: "sso_connections",
        })}
      </p>

      {error && !field && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-ink-2" role="status">
          {success}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? t("admin.sso.ssoForm.saving")
            : editing
              ? t("admin.sso.ssoForm.saveChanges")
              : t("admin.sso.addProvider")}
        </Button>
        {editing ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
