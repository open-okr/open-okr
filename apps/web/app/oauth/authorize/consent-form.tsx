import { Button, SelectInput } from "@openokr/ui";
import { getTranslations } from "../../../lib/translations";

/**
 * Approve or deny, and pick which workspace (screen S-40, P5-T08c).
 *
 * **A plain form, no client component and no JavaScript.** It posts to a route
 * handler that answers with a 303 to the client's own address. The one screen
 * standing between a stranger and somebody's data is the last place to depend on
 * a script having loaded.
 *
 * **Two buttons, not one with a toggle.** Approving an agent and refusing one
 * are different decisions, and a control where the destructive reading sits a
 * click away from the safe one is how somebody approves by accident.
 *
 * **The workspace picker only appears when there is a choice.** One grant is one
 * workspace, so a person in two has to say which; asking a person in one a
 * question with a single answer is noise.
 *
 * **No control changes the scopes.** What is granted is what was asked for. A
 * field that could widen a request is a path by which a grant becomes wider than
 * the request, and the way to grant less is to refuse and ask for less.
 */

export interface ConsentRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly scope: string;
  readonly state: string;
  readonly resource: string;
}

export async function ConsentForm({
  request,
  clientName,
  workspaces,
  activeWorkspaceId,
}: {
  readonly request: ConsentRequest;
  readonly clientName: string;
  readonly workspaces: readonly { id: string; name: string }[];
  readonly activeWorkspaceId: string;
}) {
  const { t } = await getTranslations();

  return (
    <form
      method="post"
      action="/oauth/authorize/decide"
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="clientId" value={request.clientId} />
      <input type="hidden" name="redirectUri" value={request.redirectUri} />
      <input type="hidden" name="codeChallenge" value={request.codeChallenge} />
      <input
        type="hidden"
        name="codeChallengeMethod"
        value={request.codeChallengeMethod}
      />
      <input type="hidden" name="scope" value={request.scope} />
      <input type="hidden" name="state" value={request.state} />
      <input type="hidden" name="resource" value={request.resource} />

      {workspaces.length > 1 ? (
        // Still the browser's own dropdown, which works without JavaScript
        // and lists only this person's workspaces (decided 12 October 2026).
        <SelectInput
          label={t("oauth.authorize.consentForm.whichWorkspace")}
          name="workspaceId"
          defaultValue={activeWorkspaceId}
          description={t("oauth.authorize.consentForm.willReachThisOneAnd", {
            clientName,
          })}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </SelectInput>
      ) : (
        <input type="hidden" name="workspaceId" value={activeWorkspaceId} />
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="approve"
          value="yes"
          variant="primary"
          size="sm"
        >
          {t("common.connect")}
        </Button>
        <Button
          type="submit"
          name="approve"
          value="no"
          variant="ghost"
          size="sm"
        >
          {t("common.refuse")}
        </Button>
      </div>
    </form>
  );
}
