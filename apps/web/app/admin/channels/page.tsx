import {
  ACCESS_LEVELS,
  BINDING_LABELS,
  BINDING_SOURCES,
  type BindingSource,
  callAction,
} from "@openokr/core";
import { TRIGGER_CATALOGUE } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ChannelLogo,
  Chip,
} from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import {
  disconnectProvider,
  removeTemplateMapping,
  sendTest,
  syncTemplates,
} from "./actions.ts";
import { ChannelForm } from "./channel-form.tsx";
import { CredentialForm } from "./credential-form.tsx";
import { TemplateMappingForm } from "./template-mapping-form.tsx";

export const generateMetadata = pageTitle("pageTitle.adminChannels");

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
    /** Where the provider shows what its fields ask for. */
    hint: "admin.channels.hint.slack",
    ready: true,
  },
  {
    id: "teams" as const,
    label: "Microsoft Teams",
    hint: "admin.channels.hint.teams",
    ready: true,
  },
  {
    id: "whatsapp" as const,
    label: "WhatsApp",
    hint: "admin.channels.hint.whatsapp",
    ready: true,
  },
  {
    id: "telegram" as const,
    label: "Telegram",
    hint: "admin.channels.hint.telegram",
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
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  if (level < ACCESS_LEVELS.full) {
    // Said rather than hidden. Somebody who cannot install a provider should
    // know the product has them and who to ask.
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-bold text-ink">
          {t("admin.channels.notificationsAndChannels")}
        </h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("admin.channels.connectingAChatProvider")}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {t("admin.channels.yourOwnChannelAnd")}
            </p>
          </CardBody>
        </Card>
      </div>
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-bold text-ink">
          {t("admin.channels.notificationsAndChannels")}
        </h1>
        <p className="text-xs text-ink-3">
          {t("admin.channels.emailAlwaysWorksAnd")}
        </p>
      </div>

      <GroupHeading title={t("admin.channels.groupProviders")} />

      {PROVIDERS.map((provider) => {
        const connection = connections.find(
          (row) => row.provider === provider.id,
        );
        const credentials = (
          <CredentialForm
            provider={provider.id}
            fields={CONNECT_FIELDS[provider.id].map((field) => ({
              name: field.name,
              label: t(field.label),
              secret: field.secret,
            }))}
            hint={t(provider.hint)}
          />
        );
        const facts = connection
          ? [
              {
                label: t("admin.channels.lastVerified"),
                value: when(connection.lastVerifiedAt),
                bad: false,
              },
              {
                label: t("admin.channels.workspaceId"),
                value: String(connection.config.teamId ?? "not set"),
                bad: false,
              },
              ...(connection.error
                ? [
                    {
                      label: t("admin.channels.lastComplaint"),
                      value: connection.error,
                      bad: true,
                    },
                  ]
                : []),
            ]
          : [];
        return (
          <Card key={provider.id} data-testid={`channel-card-${provider.id}`}>
            <CardHeader className="flex-wrap justify-between">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                <ChannelLogo channel={provider.id} size="sm" />
                <h2>{provider.label}</h2>
                {connection ? (
                  <Chip tone={STATE_TONE[connection.state] ?? "neutral"}>
                    {connection.state}
                  </Chip>
                ) : (
                  <Chip tone="neutral">{t("admin.channels.notConnected")}</Chip>
                )}
                {connection && !connection.lastVerifiedAt ? (
                  <Chip tone="warn">{t("admin.channels.neverVerified")}</Chip>
                ) : null}
              </span>
              {connection ? (
                <div className="flex flex-wrap items-start gap-2">
                  <ChannelForm
                    action={sendTest}
                    className="flex flex-col items-end"
                  >
                    <input type="hidden" name="attempt" value={attempt} />
                    <Button type="submit" variant="default" size="sm">
                      {t("admin.channels.sendMeATest")}
                    </Button>
                  </ChannelForm>
                  <ChannelForm
                    action={disconnectProvider}
                    className="flex flex-col items-end"
                  >
                    <input type="hidden" name="provider" value={provider.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("admin.channels.disconnect")}
                    </Button>
                  </ChannelForm>
                </div>
              ) : null}
            </CardHeader>
            {!provider.ready ? (
              <CardBody>
                <p className="text-sm text-ink-3">
                  {t("admin.channels.noDriverYetThe")}
                </p>
              </CardBody>
            ) : connection ? (
              <>
                <CardBody className="flex flex-col gap-3">
                  {/* The confirmation, from server state rather than from the
                      form's own answer. A successful connect revalidates the
                      page, which replaces the tree the form was in, so its
                      message would never survive to be read. What an
                      administrator needs to know is a fact about the
                      connection, not about the request. */}
                  {connection.lastVerifiedAt ? null : (
                    <p className="rounded-md bg-warn-bg px-2.5 py-1.5 text-xs text-warn">
                      {t("admin.channels.storedAndConnectedRather")}
                    </p>
                  )}
                  <dl className="grid grid-cols-12 gap-x-6 gap-y-3 text-xs">
                    {facts.map((fact) => (
                      <div
                        key={fact.label}
                        className={`col-span-12 flex flex-col gap-0.5 ${
                          facts.length === 3 ? "md:col-span-4" : "md:col-span-6"
                        }`}
                      >
                        <dt className="text-ink-3">{fact.label}</dt>
                        <dd className={fact.bad ? "text-bad" : "text-ink-2"}>
                          {fact.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardBody>
                <details className="group border-t border-line">
                  <summary className="cursor-pointer px-3.5 py-2.5 text-sm text-ink-3">
                    {t("admin.channels.replaceTheCredentials")}
                  </summary>
                  {credentials}
                </details>
              </>
            ) : (
              credentials
            )}
          </Card>
        );
      })}

      {whatsAppConnected ? (
        <>
          <GroupHeading title={t("admin.channels.groupWhatsapp")} />

          <Card>
            <CardHeader className="flex-wrap justify-between">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {t("admin.channels.whatsappTemplates")}
                  <Chip tone="neutral">{templates.length}</Chip>
                </h2>
                <p className="text-xs text-ink-3">
                  {t("admin.channels.whatsappWillOnlyCarry")}
                </p>
              </div>
              <ChannelForm
                action={syncTemplates}
                className="flex flex-col items-end"
              >
                <Button type="submit" variant="default" size="sm">
                  {t("admin.channels.syncFromMeta")}
                </Button>
              </ChannelForm>
            </CardHeader>
            <CardBody>
              {templates.length === 0 ? (
                <p className="text-xs text-ink-3">
                  {t("admin.channels.nothingSyncedYetPress")}
                </p>
              ) : (
                <ul
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
                  tabIndex={0}
                  aria-label={t("admin.channels.whatsappTemplates")}
                  className="flex max-h-[296px] flex-col gap-2 overflow-y-auto overscroll-contain"
                >
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
                            {template.variables === 1
                              ? t("common.count.variableOne", {
                                  count: template.variables,
                                })
                              : t("common.count.variableOther", {
                                  count: template.variables,
                                })}
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex min-w-0 flex-col gap-0.5">
                <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  {t("admin.channels.whichTemplateAnswersWhich")}
                  <Chip tone="neutral">{mappings.length}</Chip>
                </h2>
                <p className="text-xs text-ink-3">
                  {t("admin.channels.outsideTheTwentyFour")}
                </p>
              </div>
            </CardHeader>
            <CardBody>
              {mappings.length === 0 ? (
                <p className="text-xs text-ink-3">
                  {t("admin.channels.nothingMappedYet")}
                </p>
              ) : (
                <ul
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
                  tabIndex={0}
                  aria-label={t("admin.channels.whichTemplateAnswersWhich")}
                  className="flex max-h-[296px] flex-col gap-2 overflow-y-auto overscroll-contain"
                >
                  {mappings.map((mapping) => (
                    <li
                      key={mapping.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-line p-3"
                      data-testid="whatsapp-mapping"
                    >
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                          <span className="font-medium">{mapping.ruleKey}</span>
                          {t("admin.channels.uses")}
                          <span className="font-medium">
                            {mapping.templateName}
                          </span>
                          {mapping.withdrawn ? (
                            <Chip tone="bad">
                              {t("admin.channels.metaNoLongerLists")}
                            </Chip>
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
                      </span>
                      <ChannelForm
                        action={removeTemplateMapping}
                        className="flex flex-none flex-col items-end"
                      >
                        <input
                          type="hidden"
                          name="ruleKey"
                          value={mapping.ruleKey}
                        />
                        <Button type="submit" size="sm">
                          {t("common.remove")}
                        </Button>
                      </ChannelForm>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
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
          </Card>
        </>
      ) : null}

      <GroupHeading title={t("admin.channels.groupDelivery")} />

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {t("admin.channels.recentMessages")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("admin.channels.recentMessagesHint")}
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {messages.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("admin.channels.nothingHasBeenSent")}
            </p>
          ) : (
            <ul
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
              tabIndex={0}
              aria-label={t("admin.channels.recentMessages")}
              // About seven rows, then it scrolls inside the card.
              className="flex max-h-52 flex-col gap-1.5 overflow-y-auto overscroll-contain"
            >
              {messages.map((message, index) => (
                <li
                  // The message row carries no id, and two sent in the same
                  // millisecond share a time and provider. The list is
                  // read-only, so the position is a stable tiebreaker.
                  // biome-ignore lint/suspicious/noArrayIndexKey: no id on the row.
                  key={`${index}-${message.createdAt}-${message.provider}`}
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
    </div>
  );
}

/** The heading of a run of cards. */
function GroupHeading({ title }: { readonly title: string }) {
  return (
    <h2 className="mt-2 -mb-1 text-xs font-semibold tracking-wide text-ink-4 uppercase">
      {title}
    </h2>
  );
}

/** One box of a provider's connect form, named as the provider names it. */
interface ConnectField {
  /** What the action reads, the same four names for every provider. */
  readonly name: "botToken" | "signingSecret" | "verifyToken" | "teamId";
  /** Its catalogue key, written out so the catalogue gate can find it. */
  readonly label: string;
  /** A secret is masked with a reveal; an id is shown, monospace. */
  readonly secret: boolean;
}

/**
 * Each provider's boxes (guided-inputs §4.11). One set of three labels used
 * to mean four things: Teams' App ID, which is not a secret, was masked, and
 * WhatsApp's app secret and verify token went in one box split on a space.
 */
const CONNECT_FIELDS: Readonly<
  Record<(typeof PROVIDERS)[number]["id"], readonly ConnectField[]>
> = {
  slack: [
    {
      name: "botToken",
      label: "admin.channels.fields.slack.botToken",
      secret: true,
    },
    {
      name: "signingSecret",
      label: "admin.channels.fields.slack.signingSecret",
      secret: true,
    },
    {
      name: "teamId",
      label: "admin.channels.fields.slack.teamId",
      secret: false,
    },
  ],
  teams: [
    {
      name: "botToken",
      label: "admin.channels.fields.teams.botToken",
      secret: false,
    },
    {
      name: "signingSecret",
      label: "admin.channels.fields.teams.signingSecret",
      secret: true,
    },
    {
      name: "teamId",
      label: "admin.channels.fields.teams.teamId",
      secret: false,
    },
  ],
  whatsapp: [
    {
      name: "botToken",
      label: "admin.channels.fields.whatsapp.botToken",
      secret: true,
    },
    {
      name: "signingSecret",
      label: "admin.channels.fields.whatsapp.signingSecret",
      secret: true,
    },
    {
      name: "verifyToken",
      label: "admin.channels.fields.whatsapp.verifyToken",
      secret: true,
    },
    {
      name: "teamId",
      label: "admin.channels.fields.whatsapp.teamId",
      secret: false,
    },
  ],
  telegram: [
    {
      name: "botToken",
      label: "admin.channels.fields.telegram.botToken",
      secret: true,
    },
    {
      name: "signingSecret",
      label: "admin.channels.fields.telegram.signingSecret",
      secret: true,
    },
    {
      name: "teamId",
      label: "admin.channels.fields.telegram.teamId",
      secret: false,
    },
  ],
};
