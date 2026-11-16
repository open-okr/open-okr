import { loadEnv } from "@openokr/config";
import {
  callAction,
  isCloudEnabled,
  samlServiceProviderUrls,
} from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getPool } from "../../../lib/auth";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { ConnectionControls } from "./connection-controls";
import { ConnectionDomains } from "./domain-verification";
import { SSOForm } from "./sso-form";

export const generateMetadata = pageTitle("pageTitle.adminSso");

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
  const pool = getPool();
  const context = {
    pool,
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const [connections, domains, cloud] = await Promise.all([
    callAction(context, "sso.listConnections", {}),
    callAction(context, "sso.listDomains", {}),
    isCloudEnabled(pool),
  ]);
  // Marking a domain by hand is the instance administrator's, which on a
  // managed cloud is the operator and not anybody on this screen.
  const canMarkByHand = !cloud;
  const byDomain = new Map(domains.map((d) => [d.domain, d]));
  // Verified or failing: a failing one is verified until three checks fail.
  const verifiedDomains = domains
    .filter((d) => d.status === "verified" || d.status === "failing")
    .map((d) => d.domain);
  const baseUrl = loadEnv().BETTER_AUTH_URL;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("admin.sso.singleSignOn")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("admin.sso.connectAnIdentityProvider")}
        </p>
      </header>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("admin.sso.connections")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.sso.aChangeTakesEffect")}
          </p>
        </CardHeader>
        <CardBody>
          {connections.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("admin.sso.noSsoProvidersConfigured")}
            </p>
          ) : (
            <ul
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
              tabIndex={0}
              aria-label={t("admin.sso.connectionsList")}
              // Scrolls inside the card after about five rows, so a long list
              // never pushes the add card out of reach.
              className="relative flex max-h-[296px] flex-col gap-2 overflow-y-auto overscroll-contain"
            >
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
                    <ConnectionDomains
                      canMarkByHand={canMarkByHand}
                      domains={c.emailDomains
                        .split(",")
                        .map((name) => name.trim().toLowerCase())
                        .filter(Boolean)
                        .flatMap((name) => byDomain.get(name) ?? [])}
                    />
                    <ConnectionControls
                      connection={c}
                      verifiedDomains={verifiedDomains}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex-col items-stretch gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("admin.sso.addProvider")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.sso.aNewConnectionTakesEffect")}
          </p>
        </CardHeader>
        <SSOForm verifiedDomains={verifiedDomains} />
      </Card>
    </div>
  );
}
