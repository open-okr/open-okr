import { listSSOProviders } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { getPool } from "../../../lib/auth";
import { SSOForm } from "./sso-form";

/**
 * Admin SSO configuration (P8-T07, screen S-36 extension).
 *
 * Lists existing SSO connections and provides a form to add new ones.
 * Client secrets are envelope-encrypted at rest and never returned to
 * the browser after creation.
 */
export default async function SSOPage() {
  const pool = getPool();
  const connections = await listSSOProviders(pool);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">Single sign-on</h2>
          <p className="text-sm text-ink-3">
            Connect an OIDC identity provider so members can sign in with their
            organisation's credentials. SAML providers work through a
            SAML-to-OIDC bridge (Keycloak, Auth0, Okta, Azure AD).
          </p>
        </CardHeader>
        <CardBody>
          {connections.length === 0 ? (
            <p className="text-sm text-ink-3">
              No SSO providers configured. Add one below.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-control border border-ink/10 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {c.displayName}
                    </p>
                    <p className="text-xs text-ink-3">
                      {c.emailDomains || "All email domains"}
                      {c.enforce ? " (enforced)" : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    Active
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">Add provider</h2>
          <p className="text-sm text-ink-3">
            The client secret is encrypted at rest and never shown again after
            saving. A new connection takes effect on the next instance restart.
          </p>
        </CardHeader>
        <CardBody>
          <SSOForm />
        </CardBody>
      </Card>
    </div>
  );
}
