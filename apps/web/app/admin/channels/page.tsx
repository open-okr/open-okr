import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import { connectProvider, disconnectProvider, sendTest } from "./actions.ts";
import { ChannelForm } from "./channel-form.tsx";

/**
 * Notifications and channels (UIUX-PLAN.md §6 S-36, P5-T02c).
 *
 * **The screen P5-T02a left out.** That task built the driver, the inbound
 * door, the linking mechanism and the routing, and nothing in the interface
 * reached any of it: Slack was connectable only through an action call. A
 * mechanism nobody can reach is not shipped.
 *
 * **No credential is ever displayed, and the form is not pre-filled.** A field
 * showing the current bot token so an administrator could "check it" would be a
 * screen that displays a bot token, which is what the envelope encryption
 * exists to prevent. Replacing one means typing the new one.
 *
 * **Connected is not verified, and the card says which.** `last_verified_at`
 * stays null until something actually calls the provider, because a green tick
 * earned by pasting a string is the kind of reassurance that costs a support
 * hour later. The test send is how it becomes verified.
 *
 * Behind workspace administration. A bot token reaches every member of the
 * workspace, and who may install one is not a question for everybody.
 */

const PROVIDERS = [
  {
    id: "slack" as const,
    label: "Slack",
    /** What the fields are called on the provider's own app page. */
    hint: "Bot User OAuth Token, Signing Secret and Workspace ID, all on the app's Basic Information and OAuth pages.",
    ready: true,
  },
  {
    id: "teams" as const,
    label: "Microsoft Teams",
    hint: "",
    ready: false,
  },
  {
    id: "whatsapp" as const,
    label: "WhatsApp",
    hint: "",
    ready: false,
  },
  {
    id: "telegram" as const,
    label: "Telegram",
    hint: "The bot token from BotFather, and a webhook secret you choose. Register the webhook at /api/channels/telegram/<your bot id>, and put that bot id in the workspace id field.",
    ready: true,
  },
];

const STATE_TONE: Record<string, "ok" | "bad" | "neutral"> = {
  connected: "ok",
  error: "bad",
  disabled: "neutral",
};

const when = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "never";

export default async function ChannelsPage() {
  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  if (level < ACCESS_LEVELS.full) {
    // Said rather than hidden. Somebody who cannot install a provider should
    // know the product has them and who to ask.
    return (
      <>
        <h1 className="text-lg font-bold text-ink">
          Notifications and channels
        </h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              Connecting a chat provider is behind workspace administration,
              because a bot reaches everybody here. Ask an administrator.
            </p>
            <p className="mt-1 text-xs text-ink-3">
              Your own channel and quiet hours are yours to change, in your
              account settings.
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const { connections } = await callAction(
    context,
    "channels.listConnections",
    {},
  );
  const { messages } = await callAction(context, "channels.listMessages", {
    limit: 10,
  });

  // A stamp for the test button, computed on the server where the clock is
  // allowed to be read, so pressing it twice is two messages rather than one.
  const attempt = new Date().toISOString();

  return (
    <>
      <h1 className="text-lg font-bold text-ink">Notifications and channels</h1>
      <p className="text-xs text-ink-3">
        Email always works and needs nothing here. A chat provider is installed
        once per workspace; each member then links their own account.
      </p>

      {PROVIDERS.map((provider) => {
        const connection = connections.find(
          (row) => row.provider === provider.id,
        );
        return (
          <Card key={provider.id}>
            <CardHeader className="justify-between">
              <span className="flex items-center gap-2">
                {provider.label}
                {connection ? (
                  <Chip tone={STATE_TONE[connection.state] ?? "neutral"}>
                    {connection.state}
                  </Chip>
                ) : (
                  <Chip tone="neutral">not connected</Chip>
                )}
                {connection && !connection.lastVerifiedAt ? (
                  <Chip tone="warn">never verified</Chip>
                ) : null}
              </span>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {!provider.ready ? (
                <p className="text-sm text-ink-3">
                  No driver yet. The tables and the routing are ready for it, so
                  connecting one before its driver exists would store a
                  credential nothing can use.
                </p>
              ) : connection ? (
                <>
                  {/* The confirmation, from server state rather than from the
                      form's own answer. A successful connect revalidates the
                      page, which replaces the tree the form was in, so its
                      message would never survive to be read. What an
                      administrator needs to know is a fact about the
                      connection, not about the request. */}
                  {connection.lastVerifiedAt ? null : (
                    <p className="rounded-md bg-warn-bg px-2.5 py-1.5 text-xs text-warn">
                      Stored, and connected rather than verified: nothing has
                      called the provider with it yet. Send yourself a test.
                    </p>
                  )}
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1 text-xs">
                    <dt className="text-ink-3">Last verified</dt>
                    <dd className="text-ink-2">
                      {when(connection.lastVerifiedAt)}
                    </dd>
                    <dt className="text-ink-3">Workspace id</dt>
                    <dd className="text-ink-2">
                      {String(connection.config.teamId ?? "not set")}
                    </dd>
                    {connection.error ? (
                      <>
                        <dt className="text-ink-3">Last complaint</dt>
                        <dd className="text-bad">{connection.error}</dd>
                      </>
                    ) : null}
                  </dl>

                  <div className="flex flex-wrap items-center gap-2">
                    <ChannelForm action={sendTest}>
                      <input type="hidden" name="attempt" value={attempt} />
                      <Button type="submit" variant="default" size="sm">
                        Send me a test
                      </Button>
                    </ChannelForm>
                    <ChannelForm action={disconnectProvider}>
                      <input
                        type="hidden"
                        name="provider"
                        value={provider.id}
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        Disconnect
                      </Button>
                    </ChannelForm>
                  </div>

                  <details className="text-xs">
                    <summary className="cursor-pointer text-ink-3">
                      Replace the credentials
                    </summary>
                    <ConnectFields
                      provider={provider.id}
                      hint={provider.hint}
                    />
                  </details>
                </>
              ) : (
                <ConnectFields provider={provider.id} hint={provider.hint} />
              )}
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader>Recent messages</CardHeader>
        <CardBody>
          {messages.length === 0 ? (
            <p className="text-sm text-ink-3">
              Nothing has been sent yet. A nudge or a test appears here with
              what the provider said about it.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {messages.map((message) => (
                <li
                  key={`${message.createdAt}-${message.provider}`}
                  className="flex flex-wrap items-center gap-2 text-xs"
                >
                  <Chip tone="neutral">{message.provider}</Chip>
                  <Chip
                    tone={
                      message.status === "sent"
                        ? "ok"
                        : message.status === "failed"
                          ? "bad"
                          : "neutral"
                    }
                  >
                    {message.status}
                  </Chip>
                  <span className="text-ink-3">{when(message.createdAt)}</span>
                  {message.error ? (
                    <span className="text-ink-2">{message.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}

/**
 * The three fields, empty every time.
 *
 * Never pre-filled from the stored connection, which is the point: the
 * credential went in once and the product cannot read it back, so neither can
 * this screen.
 */
function ConnectFields({
  provider,
  hint,
}: {
  readonly provider: string;
  readonly hint: string;
}) {
  return (
    <ChannelForm action={connectProvider} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="provider" value={provider} />
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Bot token
        <input
          name="botToken"
          type="password"
          autoComplete="off"
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        {/* Slack signs the body; Telegram echoes a secret it was given. Two
            different claims, one field, because both are a string the
            product compares an inbound request against. */}
        Signing or webhook secret
        <input
          name="signingSecret"
          type="password"
          autoComplete="off"
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Provider workspace id
        <input
          name="teamId"
          type="text"
          autoComplete="off"
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
        />
      </label>
      {hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
      <Button type="submit" variant="primary" size="sm" className="w-fit">
        Connect
      </Button>
    </ChannelForm>
  );
}
