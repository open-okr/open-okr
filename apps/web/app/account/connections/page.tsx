import { callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import { revoke } from "./actions.ts";
import { RevokeForm } from "./revoke-form.tsx";

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
  const { session, workspace } = await requireWorkspace();
  const { connections } = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "connections.mine",
    {},
  );

  const live = connections.filter((row) => row.revokedAt === null);

  return (
    <AppShellLayout>
      <div className="mx-auto flex max-w-2xl flex-col gap-4.5">
        <Card>
          <CardHeader>
            <span className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold text-ink">Connected agents</h1>
              <Chip tone="neutral">{live.length}</Chip>
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-ink-3">
              External agents you allowed to act as you. Each one holds your own
              access, narrowed to what you granted it, in the one workspace you
              picked.
            </p>

            {connections.length === 0 ? (
              <p className="text-xs text-ink-3">
                Nothing connected. An agent starts this itself, by sending you
                here.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {connections.map((connection) => (
                  <li
                    key={connection.id}
                    className="flex flex-col gap-1 rounded-lg border border-line p-3"
                    data-testid="connection"
                  >
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {connection.clientName}
                      {connection.revokedAt ? (
                        <Chip tone="bad">revoked</Chip>
                      ) : (
                        <Chip tone="ok">active</Chip>
                      )}
                      {connection.scopes.map((scope) => (
                        <Chip key={scope} tone="neutral">
                          {scope}
                        </Chip>
                      ))}
                    </span>

                    <span className="text-xs text-ink-3">
                      {connection.lastUsedAt
                        ? `Last used ${connection.lastUsedAt.slice(0, 10)}`
                        : "Never used"}
                      {` · connected ${connection.createdAt.slice(0, 10)}`}
                    </span>

                    {connection.revokedReason ? (
                      <span
                        className="text-xs text-bad"
                        data-testid="revoked-reason"
                      >
                        {connection.revokedReason}
                      </span>
                    ) : null}

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
    </AppShellLayout>
  );
}
