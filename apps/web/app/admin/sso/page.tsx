import { loadEnv } from "@openokr/config";
import { callAction, samlServiceProviderUrls } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ConnectionControls } from "./connection-controls";
import { SSOForm } from "./sso-form";

/**
 * Admin SSO configuration (P8-T07, screen S-36 extension).
 *
 * Lists existing connections and provides a form to add one, OIDC or SAML.
 * Client secrets are envelope-encrypted at rest and never returned to the
 * browser after creation.
 *
 * **A SAML row shows the three things an identity provider asks for**
 * (P8-T07c-b). Configuring SAML is two sides of one arrangement: this
 * instance needs the provider's sign-on URL, issuer and certificate, and the
 * provider needs this instance's entity id and assertion consumer address.
 * Until they were printed here the second half was only obtainable by reading
 * the plugin's source, which is not a thing to ask of an administrator.
 *
 * **Every connection can be changed, turned off and removed here.** Until
 * then the screen only added them, and anything else meant SQL on
 * `sso_connections`. The list reads `sso.listConnections`, which holds this
 * workspace's own connections under its own tenant floor (completeness review
 * L-21), turned-off ones included so they can be turned on again, and never
 * the client secret.
 */
export default async function SSOPage() {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const connections = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "sso.listConnections",
    {},
  );
  const baseUrl = loadEnv().BETTER_AUTH_URL;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">
            {t("admin.sso.singleSignOn")}
          </h2>
          <p className="text-sm text-ink-3">
            {t("admin.sso.connectAnIdentityProvider")}
          </p>
          <p className="text-sm text-ink-3">
            {t("admin.sso.aChangeTakesEffect")}
          </p>
        </CardHeader>
        <CardBody>
          {connections.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("admin.sso.noSsoProvidersConfigured")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {connections.map((c) => {
                const urls = samlServiceProviderUrls(baseUrl, c.signInId);
                return (
                  <li
                    key={c.id}
                    className="flex flex-col gap-2 rounded-control border border-line px-3 py-2"
                    data-testid={`sso-connection-${c.providerId}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {c.displayName}
                        </p>
                        <p className="text-xs text-ink-3">
                          {c.kind === "saml"
                            ? t("admin.sso.saml2")
                            : t("admin.sso.oidc")}
                          {" · "}
                          {c.emailDomains
                            ? c.enforce
                              ? t("admin.sso.domainsEnforced", {
                                  domains: c.emailDomains,
                                })
                              : c.emailDomains
                            : c.enforce
                              ? t("admin.sso.allEmailDomainsEnforced")
                              : t("admin.sso.allEmailDomains")}
                        </p>
                      </div>
                      {/* A label beside the tone, so the state never rests
                       * on colour alone. */}
                      {c.enabled ? (
                        <Chip tone="ok" dot className="shrink-0">
                          {t("admin.sso.active")}
                        </Chip>
                      ) : (
                        <Chip tone="neutral" dot className="shrink-0">
                          {t("admin.sso.off")}
                        </Chip>
                      )}
                    </div>
                    {c.kind === "saml" && (
                      <dl
                        className="flex flex-col gap-1 border-t border-line pt-2 text-xs"
                        data-testid={`saml-details-${c.signInId}`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-ink-3">
                            {t("admin.sso.entityIdAudienceIssuer")}
                          </dt>
                          <dd className="break-all font-mono text-ink-2">
                            {urls.entityId}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-ink-3">
                            {t("admin.sso.assertionConsumerService")}
                          </dt>
                          <dd className="break-all font-mono text-ink-2">
                            {urls.acsUrl}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-ink-3">
                            {t("admin.sso.metadataDocument")}
                          </dt>
                          <dd className="break-all">
                            <a
                              href={urls.metadataUrl}
                              className="font-mono text-brand-text hover:underline"
                            >
                              {urls.metadataUrl}
                            </a>
                          </dd>
                        </div>
                      </dl>
                    )}
                    <ConnectionControls connection={c} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">
            {t("admin.sso.addProvider")}
          </h2>
          <p className="text-sm text-ink-3">
            {t("admin.sso.aNewConnectionTakesEffect")}
          </p>
        </CardHeader>
        <CardBody>
          <SSOForm />
        </CardBody>
      </Card>
    </div>
  );
}
