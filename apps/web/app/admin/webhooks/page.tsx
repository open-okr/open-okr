import {
  allowsPrivateWebhookTargets,
  callAction,
  DELIVERY_LOG_DAYS,
  FAILURES_BEFORE_OFF,
  WEBHOOK_EVENT_GROUPS,
} from "@openokr/core";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  SelectInput,
  TextInput,
  UrlInput,
} from "@openokr/ui";
import Link from "next/link";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import {
  createWebhookAction,
  rotateSecretAction,
  updateWebhookAction,
  webhookCommandAction,
} from "./actions.ts";
import {
  eventLabel,
  groupLabel,
  offReasonLabel,
  outcomeLabel,
  stateLabel,
} from "./labels";
import { WebhookAction, WebhookForm } from "./webhook-form.tsx";

export const generateMetadata = pageTitle("pageTitle.adminWebhooks");

/**
 * Admin, Webhooks: part of S-36 (docs/design/outbound-webhooks.md §3, plan
 * 0.7.0 D5, approved 10 November 2026).
 *
 * The list, a form to add one, and with `?hook=` one hook's settings, its
 * controls and the last thirty days of its deliveries. The admin layout
 * already requires `full`, so a member below it is refused before this runs,
 * and every action asks again. Loading and an error come from the admin
 * segment's own boundaries. Nothing here uses AI.
 *
 * Never a secret, except the one a create or a rotation has just made, shown
 * by the form from the action's own answer.
 */
export const dynamic = "force-dynamic";

type Translate = Awaited<ReturnType<typeof getTranslations>>["t"];

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

const STATE_TONE = { on: "ok", paused: "warn", off: "bad" } as const;

/** The grouped event boxes, ticked as the hook has them. */
function EventsField({
  t,
  checked,
}: {
  readonly t: Translate;
  readonly checked: readonly string[];
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink-2">
        {t("admin.webhooks.field.events")}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {WEBHOOK_EVENT_GROUPS.map((group) => (
          <fieldset key={group.key} className="flex flex-col gap-1">
            <legend className="text-xs font-semibold text-ink-3">
              {groupLabel(t, group.key)}
            </legend>
            {group.events.map((event) => (
              <label
                key={event}
                className="flex items-center gap-2 text-sm text-ink-2"
              >
                <input
                  type="checkbox"
                  name="events"
                  value={event}
                  defaultChecked={checked.includes(event)}
                  className="size-4"
                />
                {eventLabel(t, event)}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </fieldset>
  );
}

/** Name, space, address and events: the fields a create and an edit share. */
function HookFields({
  t,
  spaces,
  secure,
  hook,
}: {
  readonly t: Translate;
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  /** False only where hooks may reach the instance's own network (Q1). */
  readonly secure: boolean;
  readonly hook?: {
    readonly name: string;
    readonly url: string;
    readonly events: readonly string[];
    readonly spaceId: string | null;
  };
}) {
  return (
    <div className="grid grid-cols-12 gap-x-6 gap-y-4">
      <TextInput
        className="col-span-12 md:col-span-6"
        label={t("admin.webhooks.field.name")}
        name="name"
        required
        maxLength={80}
        defaultValue={hook?.name}
      />
      <SelectInput
        className="col-span-12 md:col-span-6"
        label={t("admin.webhooks.field.space")}
        name="spaceId"
        defaultValue={hook?.spaceId ?? ""}
      >
        <option value="">{t("admin.webhooks.field.everySpace")}</option>
        {spaces.map((space) => (
          <option key={space.id} value={space.id}>
            {space.name}
          </option>
        ))}
      </SelectInput>
      <UrlInput
        className="col-span-12"
        label={t("admin.webhooks.field.url")}
        description={t("admin.webhooks.field.urlDescription")}
        name="url"
        required
        maxLength={2000}
        secure={secure}
        defaultValue={hook?.url}
      />
      <div className="col-span-12">
        <EventsField t={t} checked={hook?.events ?? []} />
      </div>
    </div>
  );
}

export default async function AdminWebhooksPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const [{ webhooks }, spaces, allowPrivate] = await Promise.all([
    callAction(context, "webhooks.list", {}),
    callAction(context, "spaces.list", {}),
    allowsPrivateWebhookTargets(getPool()),
  ]);
  const selected = params.hook
    ? (webhooks.find((hook) => hook.id === params.hook) ?? null)
    : null;
  const page = Math.max(0, Number.parseInt(params.page ?? "0", 10) || 0);
  const deliveries = selected
    ? await callAction(context, "webhooks.deliveries", {
        id: selected.id,
        page,
      })
    : null;
  const spaceOptions = spaces.map((space) => ({
    id: space.id,
    name: space.name,
  }));

  const stateOf = (hook: (typeof webhooks)[number]) =>
    stateLabel(t, hook.state);
  const offWhy = (hook: (typeof webhooks)[number]) =>
    hook.state === "paused"
      ? t("admin.webhooks.pausedWhy", { owner: hook.owner.name })
      : hook.offReason === "failures"
        ? t("admin.webhooks.offReason.failures", {
            count: FAILURES_BEFORE_OFF,
          })
        : hook.offReason
          ? offReasonLabel(t, hook.offReason)
          : null;

  const cardHead = "flex-col items-stretch gap-0.5";
  const scroll =
    "relative flex max-h-[296px] flex-col gap-2 overflow-y-auto overscroll-contain";

  return (
    <div className="flex w-full flex-col gap-4">
      {selected ? (
        <>
          <header className="flex min-w-0 flex-col gap-0.5">
            <Link
              href="/admin/webhooks"
              className="text-xs text-brand-text hover:underline"
            >
              {t("admin.webhooks.back")}
            </Link>
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold text-ink">
              {selected.name}
              <Chip tone={STATE_TONE[selected.state]}>{stateOf(selected)}</Chip>
            </h1>
            <p className="text-xs text-ink-3">
              {t("admin.webhooks.owner", { name: selected.owner.name })}
            </p>
            {offWhy(selected) ? (
              <p className="text-xs text-ink-2" data-testid="webhook-why">
                {offWhy(selected)}
              </p>
            ) : null}
          </header>

          <Card>
            <CardHeader className={cardHead}>
              <h2 className="text-sm font-semibold text-ink">
                {t("admin.webhooks.actions.title")}
              </h2>
              <p className="text-xs text-ink-3">
                {t("admin.webhooks.actions.lead")}
              </p>
            </CardHeader>
            <CardBody className="flex flex-wrap items-start gap-2">
              <WebhookAction
                action={webhookCommandAction}
                hidden={{ id: selected.id, command: "test" }}
                label={t("admin.webhooks.test")}
              />
              <WebhookAction
                action={webhookCommandAction}
                hidden={{
                  id: selected.id,
                  command: selected.state === "off" ? "on" : "off",
                }}
                label={
                  selected.state === "off"
                    ? t("admin.webhooks.turnOn")
                    : t("admin.webhooks.turnOff")
                }
              />
              {selected.owner.active ? null : (
                <WebhookAction
                  action={webhookCommandAction}
                  hidden={{ id: selected.id, command: "takeOver" }}
                  label={t("admin.webhooks.takeOver")}
                />
              )}
              <WebhookAction
                action={rotateSecretAction}
                hidden={{ id: selected.id }}
                confirm={t("admin.webhooks.rotateConfirm", {
                  name: selected.name,
                })}
                label={t("admin.webhooks.rotate")}
              />
              <WebhookAction
                action={webhookCommandAction}
                hidden={{ id: selected.id, command: "remove" }}
                confirm={t("admin.webhooks.removeConfirm", {
                  name: selected.name,
                })}
                label={t("admin.webhooks.remove")}
                className="[&>button]:text-bad"
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader className={cardHead}>
              <h2 className="text-sm font-semibold text-ink">
                {t("admin.webhooks.settings")}
              </h2>
              <p className="text-xs text-ink-3">
                {t("admin.webhooks.settings.lead")}
              </p>
            </CardHeader>
            <WebhookForm
              action={updateWebhookAction}
              hidden={{ id: selected.id }}
              submitLabel={t("admin.webhooks.save")}
            >
              <HookFields
                t={t}
                spaces={spaceOptions}
                secure={!allowPrivate}
                hook={selected}
              />
            </WebhookForm>
          </Card>

          <Card>
            <CardHeader className={cardHead}>
              <h2 className="text-sm font-semibold text-ink">
                {t("admin.webhooks.deliveries.title")}
              </h2>
              <p className="text-xs text-ink-3">
                {t("admin.webhooks.deliveries.lead", {
                  days: DELIVERY_LOG_DAYS,
                })}
              </p>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {deliveries && deliveries.items.length > 0 ? (
                <ul
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
                  tabIndex={0}
                  aria-label={t("admin.webhooks.deliveries.title")}
                  // Scrolls inside the card after about five rows.
                  className={scroll}
                >
                  {deliveries.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-1 rounded-lg border border-line p-3"
                      data-testid="webhook-delivery"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                        <span className="font-medium">
                          {eventLabel(t, item.event)}
                        </span>
                        <Chip
                          tone={
                            item.outcome === "delivered"
                              ? "ok"
                              : item.outcome === "withheld"
                                ? "neutral"
                                : "bad"
                          }
                        >
                          {outcomeLabel(t, item.outcome)}
                          {item.statusCode === null
                            ? ""
                            : ` ${item.statusCode}`}
                        </Chip>
                        <span className="text-xs text-ink-3">
                          {t("admin.webhooks.deliveries.line", {
                            when: when(item.attemptedAt),
                            attempt: item.attempt,
                          })}
                        </span>
                        {item.durationMs === null ? null : (
                          <span className="text-xs text-ink-3">
                            {t("admin.webhooks.durationMs", {
                              ms: item.durationMs,
                            })}
                          </span>
                        )}
                      </span>
                      {item.subjectId ? (
                        <code className="text-xs text-ink-3">
                          {item.subjectId}
                        </code>
                      ) : null}
                      {item.reason ? (
                        <span className="text-xs text-ink-2">
                          {item.reason}
                        </span>
                      ) : null}
                      {item.outcome === "failed" ||
                      item.outcome === "refused" ? (
                        <WebhookAction
                          action={webhookCommandAction}
                          hidden={{ id: item.id, command: "redeliver" }}
                          label={t("admin.webhooks.deliveries.redeliver")}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p
                  className="text-xs text-ink-3"
                  data-testid="webhook-deliveries-empty"
                >
                  {t("admin.webhooks.deliveries.none", {
                    days: DELIVERY_LOG_DAYS,
                  })}
                </p>
              )}
              {page > 0 || deliveries?.hasMore ? (
                <nav className="flex gap-3 text-xs">
                  {page > 0 ? (
                    <Link
                      className="text-brand-text hover:underline"
                      href={`/admin/webhooks?hook=${selected.id}&page=${page - 1}`}
                    >
                      {t("admin.webhooks.deliveries.newer")}
                    </Link>
                  ) : null}
                  {deliveries?.hasMore ? (
                    <Link
                      className="text-brand-text hover:underline"
                      href={`/admin/webhooks?hook=${selected.id}&page=${page + 1}`}
                    >
                      {t("admin.webhooks.deliveries.older")}
                    </Link>
                  ) : null}
                </nav>
              ) : null}
            </CardBody>
          </Card>
        </>
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-lg font-bold text-ink">
              {t("admin.webhooks.title")}
            </h1>
            <p className="max-w-prose text-sm text-ink-3">
              {t("admin.webhooks.lead")}
            </p>
          </header>

          <Card>
            <CardHeader className={cardHead}>
              <h2 className="text-sm font-semibold text-ink">
                {t("admin.webhooks.list.title")}
              </h2>
              <p className="text-xs text-ink-3">
                {t("admin.webhooks.list.lead")}
              </p>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {params.hook ? (
                <p role="alert" className="text-xs text-bad">
                  {t("admin.webhooks.notFound")}
                </p>
              ) : null}
              {webhooks.length === 0 ? (
                <div
                  className="flex flex-col gap-1"
                  data-testid="webhooks-empty"
                >
                  <p className="text-sm font-medium text-ink">
                    {t("admin.webhooks.empty")}
                  </p>
                  <p className="text-xs text-ink-3">
                    {t("admin.webhooks.emptyBody")}
                  </p>
                </div>
              ) : (
                <ul
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
                  tabIndex={0}
                  aria-label={t("admin.webhooks.list.title")}
                  // Scrolls inside the card after about five rows, so a long
                  // list never pushes the add card out of reach.
                  className={scroll}
                >
                  {webhooks.map((hook) => (
                    <li
                      key={hook.id}
                      className="flex flex-col gap-1 rounded-lg border border-line p-3"
                      data-testid="webhook-row"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                        <Link
                          href={`/admin/webhooks?hook=${hook.id}`}
                          className="text-brand-text hover:underline"
                        >
                          {hook.name}
                        </Link>
                        <Chip tone={STATE_TONE[hook.state]}>
                          {stateOf(hook)}
                        </Chip>
                        <span className="text-xs font-normal text-ink-3">
                          {hook.host}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {hook.events.map((event) => (
                          <Chip key={event} tone="neutral">
                            {eventLabel(t, event)}
                          </Chip>
                        ))}
                      </span>
                      <span className="flex flex-wrap gap-x-3 text-xs text-ink-3">
                        <span>
                          {t("admin.webhooks.owner", { name: hook.owner.name })}
                        </span>
                        <span>
                          {hook.lastDelivery
                            ? t("admin.webhooks.lastDelivery", {
                                outcome: outcomeLabel(
                                  t,
                                  hook.lastDelivery.outcome,
                                ),
                                when: when(hook.lastDelivery.at),
                              })
                            : t("admin.webhooks.noDelivery")}
                        </span>
                      </span>
                      {offWhy(hook) ? (
                        <span className="text-xs text-ink-2">
                          {offWhy(hook)}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className={cardHead}>
              <h2 className="text-sm font-semibold text-ink">
                {t("admin.webhooks.create.title")}
              </h2>
              <p className="text-xs text-ink-3">
                {allowPrivate
                  ? t("admin.webhooks.create.leadPrivate")
                  : t("admin.webhooks.create.lead")}
              </p>
            </CardHeader>
            <WebhookForm
              action={createWebhookAction}
              submitLabel={t("admin.webhooks.create.submit")}
              testId="webhook-create"
            >
              <HookFields t={t} spaces={spaceOptions} secure={!allowPrivate} />
            </WebhookForm>
          </Card>
        </>
      )}
    </div>
  );
}
