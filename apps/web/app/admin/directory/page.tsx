import { Card, CardBody, CardHeader } from "@openokr/ui";
import { DirectoryTokenForm } from "./directory-form";

/**
 * Admin directory sync configuration (P8-T08).
 *
 * Generates a SCIM bearer token for the workspace. The identity provider
 * uses this token to push user and group changes to the SCIM endpoint.
 */
export default function DirectoryPage() {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">
            Directory synchronisation
          </h2>
          <p className="text-sm text-ink-3">
            Connect your identity provider (Okta, Azure AD, etc.) to
            automatically provision and deprovision workspace members. The
            provider pushes changes through the SCIM 2.0 protocol. Deactivation
            suspends the member and revokes every active session and token.
          </p>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-ink/10 p-4">
              <h3 className="text-sm font-medium text-ink">SCIM endpoint</h3>
              <p className="mt-1 font-mono text-sm text-ink-3">
                {typeof window !== "undefined"
                  ? `${window.location.origin}/api/scim/v2`
                  : "/api/scim/v2"}
              </p>
              <p className="mt-2 text-xs text-ink-3">
                Configure this URL in your identity provider's SCIM settings.
                The provider sends a bearer token with every request.
              </p>
            </div>
            <DirectoryTokenForm />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-ink">How it works</h2>
        </CardHeader>
        <CardBody>
          <div className="text-sm text-ink-2 space-y-2">
            <p>
              When a user is added in the directory, the identity provider calls
              the SCIM endpoint and the user is provisioned as a workspace
              member with default access.
            </p>
            <p>
              When a user is removed or deactivated in the directory, the member
              is suspended. Suspension removes every access, revokes active
              sessions, and blocks sign-in. The member is never deleted, because
              everything they wrote is attributed to them.
            </p>
            <p>
              Groups in the directory map to spaces. When a user is added to a
              directory group, they are added to the corresponding space.
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
