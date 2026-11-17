import { callAction } from "@openokr/core";
import { Card, CardBody, Chip } from "@openokr/ui";
import { Bot } from "lucide-react";
import { AgentCallsLine } from "../../../lib/agent-calls-line";
import { getInstanceName } from "../../../lib/instance-name";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { revoke } from "./actions.ts";
import { RevokeForm } from "./revoke-form.tsx";

export const generateMetadata = pageTitle("pageTitle.connections");

/**
 * The agents this person connected, and how they end one (screen S-40,
 * P5-T08c).
 *
 * **A revoked connection stays on the list, with the reason.** "You ended this"
 * and "a refresh token was presented twice" are very different things to read
 * weeks later, and the second is the only way somebody finds out their agent was
 * compromised. Quietly removing the row would remove the only notice there is.
 *
 * **Only this person's own connections, and no member id anywhere.** A screen
 * that could show somebody else's would be a screen somebody could aim at a
 * colleague.
 */
export default async function ConnectionsPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const { connections } = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
      // The command line is named for this instance (M-33).
      instanceName: await getInstanceName(),
    },
    "connections.mine",
    {},
  );

  const live = connections.filter((row) => row.revokedAt === null);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-ink">
            {t("account.connections.connectedAgents")}
          </h1>
          <Chip tone="neutral">{live.length}</Chip>
        </span>
        <p className="max-w-prose text-sm text-ink-3">
          {t("account.connections.externalAgentsYouAllowed")}
        </p>
      </header>

      <Card>
        <CardBody>
          {connections.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("account.connections.nothingConnectedAnAgent")}
            </p>
          ) : (
            // Scrolls inside the card at about five rows; tabIndex lets a
            // keyboard user scroll it.
            <ul
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
              tabIndex={0}
              aria-label={t("account.connections.listLabel")}
              className="max-h-[296px] overflow-y-auto pr-1.5 overscroll-contain rounded-lg border border-line"
            >
              {connections.map((connection, index) => (
                <li
                  key={connection.id}
                  className={`flex items-start gap-3 px-3 py-2.5 ${index === 0 ? "" : "border-line border-t"}`}
                  data-testid="connection"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-3">
                    <Bot className="size-4" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {connection.clientName}
                      {connection.revokedAt ? (
                        <Chip tone="bad">{t("common.revoked")}</Chip>
                      ) : (
                        <Chip tone="ok">{t("common.active")}</Chip>
                      )}
                      {connection.scopes.map((scope) => (
                        <Chip key={scope} tone="neutral">
                          {scope}
                        </Chip>
                      ))}
                    </span>

                    <span className="text-xs text-ink-3">
                      {connection.lastUsedAt
                        ? t("account.connections.lastUsedConnected", {
                            lastUsed: connection.lastUsedAt.slice(0, 10),
                            connected: connection.createdAt.slice(0, 10),
                          })
                        : t("account.connections.neverUsedConnected", {
                            connected: connection.createdAt.slice(0, 10),
                          })}
                    </span>

                    {connection.revokedReason ? (
                      <span
                        className="text-xs text-bad"
                        data-testid="revoked-reason"
                      >
                        {connection.revokedReason}
                      </span>
                    ) : null}

                    <AgentCallsLine kind="grant" id={connection.id} />
                  </span>
                  {connection.revokedAt ? null : (
                    <RevokeForm action={revoke} id={connection.id} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
