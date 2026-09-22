import { loadEnv } from "@openokr/config";
import { listSSOProviders, samlServiceProviderUrls } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { getPool } from "../../../lib/auth";
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
  const pool = getPool();
  const connections = await listSSOProviders(pool);
  const baseUrl = loadEnv().BETTER_AUTH_URL;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">Single sign-on</h2>
          <p className="text-sm text-ink-3">
            Connect an identity provider so members sign in with their
            organisation's credentials. OpenOKR speaks OIDC and SAML 2.0
            directly; neither needs a bridge.
          </p>
        </CardHeader>
        <CardBody>
          {connections.length === 0 ? (
            <p className="text-sm text-ink-3">
              No SSO providers configured. Add one below.
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
                          {c.kind === "saml" ? "SAML 2.0" : "OIDC"}
                          {" · "}
                          {c.emailDomains || "All email domains"}
                          {c.enforce ? " (enforced)" : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Active
                      </span>
                    </div>
                    {c.kind === "saml" && (
                      <dl
                        className="flex flex-col gap-1 border-t border-ink/10 pt-2 text-xs"
                        data-testid={`saml-details-${c.id}`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-ink-3">
                            Entity ID (audience, issuer)
                          </dt>
                          <dd className="break-all font-mono text-ink-2">
                            {urls.entityId}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-ink-3">
                            Assertion consumer service (reply URL)
                          </dt>
                          <dd className="break-all font-mono text-ink-2">
                            {urls.acsUrl}
                          </dd>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <dt className="text-ink-3">Metadata document</dt>
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
          <h2 className="text-base font-semibold text-ink">Add provider</h2>
          <p className="text-sm text-ink-3">
            A new connection takes effect on the next instance restart. An OIDC
            client secret is encrypted at rest and never shown again after
            saving.
          </p>
        </CardHeader>
        <CardBody>
          <SSOForm />
        </CardBody>
      </Card>
    </div>
  );
}
