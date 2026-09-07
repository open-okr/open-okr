import {
  ACCESS_LEVELS,
  BINDING_LABELS,
  BINDING_SOURCES,
  type BindingSource,
  callAction,
} from "@openokr/core";
import { TRIGGER_CATALOGUE } from "@openokr/method";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import {
  connectProvider,
  disconnectProvider,
  removeTemplateMapping,
  sendTest,
  syncTemplates,
} from "./actions.ts";
import { ChannelForm } from "./channel-form.tsx";
import { TemplateMappingForm } from "./template-mapping-form.tsx";

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
    hint: "The Application (client) ID and a client secret from the Azure bot registration, and the Directory (tenant) ID in the workspace id field. Point the bot's messaging endpoint at /api/channels/teams. The manifest to upload is in deploy/teams.",
    ready: true,
  },
  {
    id: "whatsapp" as const,
    label: "WhatsApp",
    hint: "The permanent access token in the bot token box, the app secret in the signing secret box, and the Phone number ID in the workspace id field. Choose a verify token of your own and put it after the app secret, separated by a space. Point the webhook at /api/channels/whatsapp?phone_number_id=<your phone number id>. deploy/whatsapp has the runbook.",
    ready: true,
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
  // Only if WhatsApp is connected: a workspace that has never touched it has
  // nothing to sync and a section explaining that would be a section about
  // nothing.
  const whatsAppConnected = connections.some(
    (row) => row.provider === "whatsapp" && row.state === "connected",
  );
  const { templates } = whatsAppConnected
    ? await callAction(context, "channels.templates", {})
    : { templates: [] };
  const { mappings } = whatsAppConnected
    ? await callAction(context, "channels.templateMappings", {})
    : { mappings: [] };
  // Only the approved ones can be mapped: Meta refuses a send using anything
  // else, so offering one would be offering a choice that silently never
  // arrives.
  const approved = templates.filter(
    (template) => template.status.toUpperCase() === "APPROVED",
  );

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

      {whatsAppConnected ? (
        <Card>
          <CardHeader>
            <span className="flex flex-wrap items-center gap-2">
              WhatsApp templates
              <Chip tone="neutral">{templates.length}</Chip>
            </span>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-ink-3">
              WhatsApp will only carry a message you send first if Meta approved
              the words in advance. These are the templates this workspace has,
              read from Meta rather than written here: the words are yours, the
              approval is theirs.
            </p>

            <ChannelForm action={syncTemplates}>
              <Button type="submit" variant="default" size="sm">
                Sync from Meta
              </Button>
            </ChannelForm>

            {templates.length === 0 ? (
              <p className="text-xs text-ink-3">
                Nothing synced yet. Press the button, or submit a template in
                the Meta console first.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {templates.map((template) => (
                  <li
                    key={template.id}
                    className="flex flex-col gap-1 rounded-lg border border-line p-3"
                    data-testid="whatsapp-template"
                  >
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {template.name}
                      <Chip
                        tone={
                          template.status.toUpperCase() === "APPROVED"
                            ? "ok"
                            : template.status.toUpperCase() === "REJECTED"
                              ? "bad"
                              : "warn"
                        }
                      >
                        {template.status.toLowerCase()}
                      </Chip>
                      <span className="text-xs font-normal text-ink-3">
                        {template.language}
                      </span>
                      {template.variables > 0 ? (
                        <Chip tone="neutral">
                          {template.variables} variable
                          {template.variables === 1 ? "" : "s"}
                        </Chip>
                      ) : null}
                    </span>
                    {template.bodyText ? (
                      <span className="whitespace-pre-wrap text-xs text-ink-3">
                        {template.bodyText}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-col gap-2 border-t border-line pt-3">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                Which template answers which reminder
                <Chip tone="neutral">{mappings.length}</Chip>
              </span>
              <p className="text-xs text-ink-3">
                Outside the twenty-four hours after somebody last writes to you,
                WhatsApp carries only an approved template. A reminder with no
                template mapped still reaches the member's inbox here; it just
                does not reach their phone.
              </p>

              {mappings.length === 0 ? (
                <p className="text-xs text-ink-3">Nothing mapped yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {mappings.map((mapping) => (
                    <li
                      key={mapping.id}
                      className="flex flex-col gap-1 rounded-lg border border-line p-3"
                      data-testid="whatsapp-mapping"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                        <span className="font-medium">{mapping.ruleKey}</span>
                        uses
                        <span className="font-medium">
                          {mapping.templateName}
                        </span>
                        {mapping.withdrawn ? (
                          <Chip tone="bad">Meta no longer lists it</Chip>
                        ) : mapping.templateStatus.toUpperCase() ===
                          "APPROVED" ? null : (
                          <Chip tone="warn">
                            {mapping.templateStatus.toLowerCase()}
                          </Chip>
                        )}
                      </span>
                      {mapping.bindings.length > 0 ? (
                        <span className="text-xs text-ink-3">
                          {mapping.bindings
                            .map(
                              (source, index) =>
                                `{{${index + 1}}} ${BINDING_LABELS[source as BindingSource] ?? source}`,
                            )
                            .join(", ")}
                        </span>
                      ) : null}
                      <ChannelForm
                        action={removeTemplateMapping}
                        className="w-fit"
                      >
                        <input
                          type="hidden"
                          name="ruleKey"
                          value={mapping.ruleKey}
                        />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </ChannelForm>
                    </li>
                  ))}
                </ul>
              )}

              <TemplateMappingForm
                rules={TRIGGER_CATALOGUE.map((entry) => ({
                  key: entry.key,
                  fires: entry.fires,
                }))}
                templates={approved.map((template) => ({
                  id: template.id,
                  name: template.name,
                  language: template.language,
                  variables: template.variables,
                  bodyText: template.bodyText ?? null,
                }))}
                sources={BINDING_SOURCES.map((source) => ({
                  value: source,
                  label: BINDING_LABELS[source],
                }))}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

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
