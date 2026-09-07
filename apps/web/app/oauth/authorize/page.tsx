import {
  checkAuthoriseRequestFor,
  redirectWith,
  SCOPE_DESCRIPTIONS,
} from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { redirect } from "next/navigation";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { instanceIssuer } from "../../../lib/issuer";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import { ConsentForm } from "./consent-form.tsx";

/**
 * Screen S-40: connecting an external agent (AI-NATIVE-PLAN.md §8.2, P5-T08c).
 *
 * **Behind the ordinary session gate, deliberately.** A client cannot prove who
 * it is; a browser already has. The proxy sends a signed-out visitor to sign in
 * and back here, so an agent on a machine that has never been logged in works
 * without ever seeing a password.
 *
 * **Everything is validated before a person is shown anything.** An unknown
 * client, an unregistered address, a missing challenge: all refused at the point
 * the browser arrives. A screen that asks "do you allow this?" about a request
 * the server was always going to refuse wastes the one thing a person brought to
 * it.
 *
 * **Where a refusal goes depends on whether the redirect can be trusted.** An
 * error about the client's identity or its address is shown here, because
 * bouncing it to an address that failed validation hands the error, and the
 * request's state, to whoever supplied that address. Everything else goes back
 * to the client, which is what lets an agent report a refusal properly.
 *
 * **The client's name is its own claim.** It is rendered as text and read as
 * nothing: an agent calling itself "Finance Copilot" has only said so.
 */
export default async function AuthorisePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };

  const request = {
    clientId: one("client_id"),
    redirectUri: one("redirect_uri"),
    responseType: one("response_type") || "code",
    codeChallenge: one("code_challenge"),
    codeChallengeMethod: one("code_challenge_method") || "S256",
    scope: one("scope"),
    state: one("state"),
    resource: one("resource"),
  };

  const bounced = one("error_message");
  const { workspace, memberships } = await requireWorkspace();
  const issuer = instanceIssuer();

  const check = await checkAuthoriseRequestFor(getPool(), {
    workspaceId: workspace.workspaceId,
    request,
    issuer,
  });

  if (check.kind === "refused" && check.refusal.kind === "redirect") {
    // The address is the client's own, so the error may travel to it. `state`
    // is echoed exactly as it arrived; its whole purpose is that the client
    // recognises it.
    redirect(
      redirectWith(request.redirectUri, {
        error: check.refusal.error,
        error_description: check.refusal.description,
        state: request.state,
      }),
    );
  }

  return (
    <AppShellLayout>
      <div className="mx-auto flex max-w-xl flex-col gap-4.5">
        <Card>
          <CardHeader>
            <h1 className="text-lg font-bold text-ink">Connect an agent</h1>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {bounced ? (
              // What the decision handler could not do, said on the screen it
              // sent the person back to.
              <p
                role="alert"
                className="rounded-md bg-bad-bg px-2.5 py-2 text-sm text-bad"
              >
                {bounced}
              </p>
            ) : null}
            {check.kind === "refused" ? (
              <p
                role="alert"
                className="rounded-md bg-bad-bg px-2.5 py-2 text-sm text-bad"
              >
                {/* Only the "show" kind reaches here: the redirect kind left
                    the page above. */}
                {check.refusal.kind === "show"
                  ? check.refusal.message
                  : check.refusal.description}
              </p>
            ) : (
              <>
                <p className="text-sm text-ink-3">
                  <span className="font-medium text-ink">
                    {check.clientName}
                  </span>{" "}
                  asked to act as you. It will get your own access, narrowed to
                  what is listed below, and nothing more. It never sees your
                  password.
                </p>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-ink-2">
                    What it will be able to do
                  </span>
                  <ul className="flex flex-col gap-1">
                    {check.scopes.map((scope) => (
                      <li
                        key={scope}
                        className="flex items-center gap-2 text-sm text-ink"
                        data-testid="consent-scope"
                      >
                        <Chip tone={scope === "read" ? "neutral" : "warn"}>
                          {scope}
                        </Chip>
                        {SCOPE_DESCRIPTIONS[scope] ?? scope}
                      </li>
                    ))}
                  </ul>
                </div>

                <ConsentForm
                  request={request}
                  clientName={check.clientName}
                  workspaces={memberships.map((membership) => ({
                    id: membership.workspaceId,
                    name: membership.name,
                  }))}
                  activeWorkspaceId={workspace.workspaceId}
                />
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
