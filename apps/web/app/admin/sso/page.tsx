import { loadEnv } from "@openokr/config";
import {
  listWorkspaceSSOProviders,
  samlServiceProviderUrls,
} from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { getPool } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
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
 */
export default async function SSOPage() {
  const { t } = await getTranslations();
  const pool = getPool();
  const { workspace } = await requireWorkspace();
  // This workspace's own, never the instance's (completeness review L-21).
  const connections = await listWorkspaceSSOProviders(
    pool,
    workspace.workspaceId,
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
        </CardHeader>
        <CardBody>
          {connections.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("admin.sso.noSsoProvidersConfigured")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {connections.map((c) => {
                const urls = samlServiceProviderUrls(baseUrl, c.id);
                return (
                  <li
                    key={c.id}
                    className="flex flex-col gap-2 rounded-control border border-ink/10 px-3 py-2"
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
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        {t("admin.sso.active")}
                      </span>
                    </div>
                    {c.kind === "saml" && (
                      <dl
                        className="flex flex-col gap-1 border-t border-ink/10 pt-2 text-xs"
                        data-testid={`saml-details-${c.id}`}
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
