/**
 * The instructions an agent fetches after a member pastes the setup line
 * (docs/design/agent-setup-prompt.md §9.2).
 *
 * **Public, and so it holds nothing private.** The agent has no session. The
 * file names the endpoint, which `/.well-known/oauth-protected-resource`
 * already publishes, and the instance's name, which the sign-in page already
 * shows. No token and nothing of any workspace is read or written.
 */
import { resourceIdentifier } from "@openokr/core";
import { agentSetupMarkdown } from "../../../lib/agent-setup-prompt.ts";
import { getInstanceName } from "../../../lib/instance-name";
import { instanceIssuer } from "../../../lib/issuer";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const origin = instanceIssuer();
  const body = agentSetupMarkdown({
    instanceName: await getInstanceName(),
    origin,
    endpoint: resourceIdentifier(origin),
  });
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // It changes only when the instance's address or name does.
      "cache-control": "public, max-age=300",
    },
  });
}
