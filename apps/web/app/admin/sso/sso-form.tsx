"use client";

import type { SSOConnectionDetails } from "@openokr/core";
import {
  Button,
  CardBody,
  IdentifierInput,
  SelectInput,
  TextArea,
  TokenInput,
  UrlInput,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  verifiedDomains = [],
  onSaved,
  onCancel,
}: {
  /** The connection being changed. Absent when adding one. */
  readonly connection?: SSOConnectionDetails;
  /**
   * The domains this workspace has proved it owns. Enforcement is offered
   * only over those (docs/design/sso-domain-verification.md, rule 3).
   */
  readonly verifiedDomains?: readonly string[];
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
  // Watched, not read at submit, because whether enforcement may be turned on
  // depends on what is listed in the box right now.
  const [domains, setDomains] = useState<readonly string[]>(() =>
    (connection?.emailDomains ?? "")
      .split(",")
      .map((one) => one.trim().toLowerCase())
      .filter(Boolean),
  );
  const [enforce, setEnforce] = useState(connection?.enforce ?? false);
  const verified = new Set(verifiedDomains);
  const unverified = domains.filter((one) => !verified.has(one));
  // A connection that already enforces keeps its box, so an edit never turns
  // enforcement off behind the person's back (decision 2). Only turning it on
  // waits for the proof.
  const enforceBlocked = unverified.length > 0 && !enforce;

  // Two forms can be on the screen at once while a connection is edited, so
  // an edit form's ids are its own, or its labels would name the add form's
  // inputs. The add form keeps the `field-<name>` ids it always had.
  const idFor = (name: string) =>
    connection ? `sso-${connection.id}-${name}` : `field-${name}`;

  // What is unsaved, named by field (docs/design/settings-page-layout.md §C).
  // The token inputs post through hidden fields that raise no input event, so
  // `tick` is bumped by them and by the form's own events, and the snapshot is
  // read after the render that holds the new value.
  const formRef = useRef<HTMLFormElement>(null);
  const [tick, setTick] = useState(0);
  const [base, setBase] = useState<ReadonlyMap<string, string> | null>(null);
  const [values, setValues] = useState<ReadonlyMap<string, string> | null>(
    null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the listed values are what changes the posted fields
  useEffect(() => {
    const element = formRef.current;
    if (!element) {
      return;
    }
    const now = readFields(element);
    setValues(now);
    setBase((current) => current ?? now);
  }, [tick, kind, enforce, domains]);
  const rebase = () => {
    const element = formRef.current;
    if (!element) {
      return;
    }
    const now = readFields(element);
    setBase(now);
    setValues(now);
  };
  const labelOf = (name: string): string => {
    switch (name) {
      case "kind":
        return t("admin.sso.ssoForm.protocol");
      case "providerId":
        return t("admin.sso.ssoForm.providerId");
      case "displayName":
        return t("admin.sso.ssoForm.displayName");
      case "discoveryUrl":
        return t("admin.sso.ssoForm.discoveryUrl");
      case "authorizationUrl":
        return t("admin.sso.ssoForm.authorizationUrl");
      case "tokenUrl":
        return t("admin.sso.ssoForm.tokenUrl");
      case "userInfoUrl":
        return t("admin.sso.ssoForm.userInfoUrl");
      case "clientId":
        return t("admin.sso.ssoForm.clientId");
      case "clientSecret":
        return t("admin.sso.ssoForm.clientSecret");
      case "scopes":
        return t("account.apiTokens.scopes");
      case "samlEntryPoint":
        return t("admin.sso.ssoForm.signOnUrl");
      case "samlIssuer":
        return t("admin.sso.ssoForm.issuer");
      case "samlCertificate":
        return t("admin.sso.ssoForm.signingCertificate");
      case "samlAudience":
        return t("admin.sso.ssoForm.audienceOptional");
      case "emailDomains":
        return t("admin.sso.ssoForm.emailDomains");
      case "enforce":
        return t("admin.sso.ssoForm.enforceSso");
      default:
        return name;
    }
  };
  const unsaved: readonly string[] =
    base === null || values === null
      ? []
      : [
          ...new Set(
            [...new Set([...base.keys(), ...values.keys()])]
              .filter(
                (name) => (base.get(name) ?? "") !== (values.get(name) ?? ""),
              )
              .map(labelOf),
          ),
        ];

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
    // The reset clears the messages, so the success line comes after it.
    element.reset();
    setSuccess(t("admin.sso.ssoForm.providerSaved"));
    setTimeout(rebase, 0);
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

  const saveLabel = pending
    ? t("admin.sso.ssoForm.saving")
    : editing
      ? t("admin.sso.ssoForm.saveChanges")
      : t("admin.sso.addProvider");
  const idle = unsaved.length === 0 && !success && !error;

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onInput={() => setTick((n) => n + 1)}
      onChange={() => setTick((n) => n + 1)}
      onReset={() => {
        // Discard puts the browser's defaults back. The controlled values
        // and the messages are put back here, and the snapshot is read once
        // the browser has finished.
        setKind("oidc");
        setEnforce(connection?.enforce ?? false);
        setDomains(
          (connection?.emailDomains ?? "")
            .split(",")
            .map((one) => one.trim().toLowerCase())
            .filter(Boolean),
        );
        setError("");
        setField("");
        setSuccess("");
        setTimeout(() => setTick((n) => n + 1), 0);
      }}
      className="flex flex-col"
      aria-busy={pending}
      aria-label={
        connection
          ? t("admin.sso.ssoForm.editConnection", {
              name: connection.displayName,
            })
          : undefined
      }
    >
      <CardBody>
        <div className="grid grid-cols-12 gap-x-6 gap-y-4">
          {connection ? (
            <p className="col-span-12 text-sm text-ink-2">
              {t("admin.sso.ssoForm.protocolFixed", { protocol: protocolName })}
            </p>
          ) : (
            <SelectInput
              className="col-span-12 lg:col-span-4"
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
          )}

          {/* The server's own rule as it is typed: capitals lowered, and
              anything else marked (guided-inputs §4.11). */}
          <IdentifierInput
            className={
              editing
                ? "col-span-12 md:col-span-6"
                : "col-span-12 md:col-span-6 lg:col-span-4"
            }
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
            className={
              editing
                ? "col-span-12 md:col-span-6"
                : "col-span-12 md:col-span-6 lg:col-span-4"
            }
            id={idFor("displayName")}
            label={t("admin.sso.ssoForm.displayName")}
            name="displayName"
            placeholder={t("admin.sso.ssoForm.displayNamePlaceholder")}
            defaultValue={connection?.displayName}
            required
            error={errorFor("displayName")}
          />

          {kind === "oidc" ? (
            <>
              {/* Each a whole https address, the rule the server applies. */}
              <UrlInput
                className="col-span-12"
                id={idFor("discoveryUrl")}
                label={t("admin.sso.ssoForm.discoveryUrl")}
                name="discoveryUrl"
                secure
                placeholder={t("admin.sso.ssoForm.discoveryUrlPlaceholder")}
                defaultValue={connection?.discoveryUrl ?? undefined}
                description={t("admin.sso.ssoForm.ifADiscoveryUrlIsSet")}
                error={errorFor("discoveryUrl")}
              />
              <UrlInput
                className="col-span-12 lg:col-span-4"
                id={idFor("authorizationUrl")}
                label={t("admin.sso.ssoForm.authorizationUrl")}
                name="authorizationUrl"
                secure
                placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
                defaultValue={connection?.authorizationUrl ?? undefined}
                error={errorFor("authorizationUrl")}
              />
              <UrlInput
                className="col-span-12 lg:col-span-4"
                id={idFor("tokenUrl")}
                label={t("admin.sso.ssoForm.tokenUrl")}
                name="tokenUrl"
                secure
                placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
                defaultValue={connection?.tokenUrl ?? undefined}
                error={errorFor("tokenUrl")}
              />
              <UrlInput
                className="col-span-12 lg:col-span-4"
                id={idFor("userInfoUrl")}
                label={t("admin.sso.ssoForm.userInfoUrl")}
                name="userInfoUrl"
                secure
                placeholder={t("admin.sso.ssoForm.urlPlaceholder")}
                defaultValue={connection?.userInfoUrl ?? undefined}
                error={errorFor("userInfoUrl")}
              />
              <Field
                className="col-span-12 md:col-span-6"
                id={idFor("clientId")}
                label={t("admin.sso.ssoForm.clientId")}
                name="clientId"
                defaultValue={connection?.clientId ?? undefined}
                required
                error={errorFor("clientId")}
              />
              {/* Never filled in. The stored secret is sealed and stays on
               * the server; blank on an edit keeps it. */}
              <Field
                className="col-span-12 md:col-span-6"
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
              {/* A chip each, posted space-separated as the provider reads
                  them (guided-inputs §4.11). */}
              <TokenInput
                className="col-span-12"
                id={idFor("scopes")}
                label={t("account.apiTokens.scopes")}
                name="scopes"
                joiner=" "
                placeholder={t("admin.sso.ssoForm.scopesPlaceholder")}
                defaultValue={(connection?.scopes ?? "")
                  .split(" ")
                  .filter(Boolean)}
                onValueChange={() => setTick((n) => n + 1)}
              />
            </>
          ) : (
            <>
              <UrlInput
                className="col-span-12"
                id={idFor("samlEntryPoint")}
                label={t("admin.sso.ssoForm.signOnUrl")}
                name="samlEntryPoint"
                placeholder={t("admin.sso.ssoForm.signOnUrlPlaceholder")}
                defaultValue={connection?.samlEntryPoint ?? undefined}
                required
                error={errorFor("samlEntryPoint")}
              />
              <Field
                className="col-span-12 md:col-span-6"
                id={idFor("samlIssuer")}
                label={t("admin.sso.ssoForm.issuer")}
                name="samlIssuer"
                placeholder={t("admin.sso.ssoForm.issuerPlaceholder")}
                defaultValue={connection?.samlIssuer ?? undefined}
                required
                error={errorFor("samlIssuer")}
              />
              <Field
                className="col-span-12 md:col-span-6"
                id={idFor("samlAudience")}
                label={t("admin.sso.ssoForm.audienceOptional")}
                name="samlAudience"
                placeholder={t(
                  "admin.sso.ssoForm.leaveEmptyToUseThisInstancesUrl",
                )}
                defaultValue={connection?.samlAudience ?? undefined}
              />
              <TextArea
                className="col-span-12"
                label={t("admin.sso.ssoForm.signingCertificate")}
                id={idFor("samlCertificate")}
                name="samlCertificate"
                rows={5}
                required
                placeholder={t("admin.sso.ssoForm.certificatePlaceholder")}
                defaultValue={connection?.samlCertificate ?? undefined}
                description={t("admin.sso.ssoForm.pasteTheCertificate")}
                inputClassName="font-mono text-xs"
                error={errorFor("samlCertificate")}
              />
            </>
          )}

          {/* Each a domain, on the rule the server now applies (§4.11). */}
          <TokenInput
            className="col-span-12"
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
            onValueChange={(entries) =>
              setDomains(entries.map((one) => one.toLowerCase()))
            }
          />

          <div className="col-span-12 flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                name="enforce"
                className="rounded"
                checked={enforce}
                disabled={enforceBlocked}
                aria-describedby={idFor("enforceReason")}
                onChange={(event) => setEnforce(event.currentTarget.checked)}
              />
              {t("admin.sso.ssoForm.enforceSsoForTheEmailDomains")}
            </label>
            {/* Always on the screen, so that its appearing never moves the
             * buttons below it: the domain box commits on blur, which is the
             * mouse-down on "Add provider", and a layout shift there loses
             * the click. */}
            <p id={idFor("enforceReason")} className="text-xs text-ink-3">
              {enforceBlocked
                ? t("admin.sso.ssoForm.enforceNeedsVerification", {
                    domains: unverified.join(", "),
                  })
                : t("admin.sso.ssoForm.enforceHint")}
            </p>
            {errorFor("enforce") ? (
              <p className="text-sm text-bad" role="alert">
                {errorFor("enforce")}
              </p>
            ) : null}
            <p className="text-xs text-ink-3">
              {t("admin.sso.ssoForm.enforcingRefusesAPassword", {
                column: "enforce",
                table: "sso_connections",
              })}
            </p>
          </div>
        </div>
      </CardBody>

      {/* The shared save bar's footer, written here because this card needs
          its own submit label and a Cancel beside Discard. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          {idle ? (
            <p className="text-sm text-ink-3">{t("common.noChanges")}</p>
          ) : null}
          {unsaved.length > 0 ? (
            <p role="status" className="text-sm font-medium text-ink">
              {t("common.notSavedYet", { parts: unsaved.join(", ") })}
            </p>
          ) : null}
          {success ? (
            <p role="status" className="text-xs text-ink-2">
              {success}
            </p>
          ) : null}
          {error && !field ? (
            <p className="text-xs text-bad" role="alert">
              {error}
            </p>
          ) : null}
          {error && field ? (
            // The field already holds the alert, so this line is a status.
            <p role="status" className="text-xs text-bad">
              {t("admin.sso.ssoForm.nothingSaved")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-none items-center gap-2">
          {editing ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          ) : null}
          <Button
            type="reset"
            variant="ghost"
            size="sm"
            disabled={pending || unsaved.length === 0}
          >
            {t("common.discard")}
          </Button>
          <Button type="submit" variant="primary" size="sm" pending={pending}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The posted text fields of a form, by name, for the unsaved comparison. */
function readFields(form: HTMLFormElement): ReadonlyMap<string, string> {
  const fields = new Map<string, string>();
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value === "string") {
      fields.set(name, value);
    }
  }
  return fields;
}
