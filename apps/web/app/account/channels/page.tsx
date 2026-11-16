import { callAction } from "@openokr/core";
import { NOTIFICATION_REASONS } from "@openokr/db";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { saveCadence, saveDelivery, startLink, unlink } from "./actions.ts";
import { CadenceForm } from "./cadence-form.tsx";
import { DeliveryForm, LinkedAccounts } from "./link-form.tsx";

export const generateMetadata = pageTitle("pageTitle.accountChannels");

/**
 * Where the product reaches me (UIUX-PLAN.md §6 S-36, P5-T02c).
 *
 * Every member's own page, at `comment` level, because telling the product
 * where to send its reminders cannot be a privilege only editors have: a member
 * at `view` still receives nudges.
 *
 * **The linking code is shown once and never again.** The row holds its hash,
 * so this render is the only place it exists. Asking again replaces it, which
 * is what pressing the button twice means.
 *
 * **A quiet window loses nothing.** AI-NATIVE-PLAN §5.4 defers a nudge inside
 * it to the next open window rather than dropping it, and the copy says so,
 * because a member who believes quiet hours delete their reminders will not set
 * any.
 */

/**
 * The six reasons a notification exists, in the words a member reads.
 *
 * Enumerated from the table's own constant rather than written out, so a
 * seventh reason appears on this card without anybody remembering it exists.
 * The labels are here because they are wording; the list is not. Each is a
 * catalogue key, so the wording reaches a reader in their own language.
 */
const REASON_LABELS: Readonly<Record<string, string>> = {
  mentioned: "account.channels.reasonMentioned",
  review: "account.channels.reasonReview",
  check_in: "account.channels.reasonCheckIn",
  invited: "account.channels.reasonInvited",
  joined: "account.channels.reasonJoined",
  role: "account.channels.reasonRole",
  support_request: "account.channels.reasonSupportRequest",
  support_ended: "account.channels.reasonSupportEnded",
  connection_ended: "account.channels.reasonConnectionEnded",
  self_deleted: "account.channels.reasonSelfDeleted",
};

const CHOICES = [
  {
    id: "app",
    labelKey: "account.channels.inTheProductOnly",
    needsLink: false,
  },
  {
    id: "email",
    labelKey: "people.detail.profileForm.email",
    needsLink: false,
  },
  { id: "slack", labelKey: "channels.slack", needsLink: true },
  { id: "teams", labelKey: "channels.teams", needsLink: true },
  { id: "whatsapp", labelKey: "channels.whatsapp", needsLink: true },
  { id: "telegram", labelKey: "channels.telegram", needsLink: true },
] as const;

export default async function AccountChannelsPage() {
  const { t } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const settings = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "channels.mySettings",
    {},
  );

  const cadence = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human", userId: session.user.id },
    },
    "notifications.getSettings",
    {},
  );

  const linked = new Set(
    settings.identities
      .filter((identity) => identity.verifiedAt !== null)
      .map((identity) => identity.provider),
  );
  const connected = new Set(settings.connected);

  const tiles = settings.connected.map((provider) => ({
    provider,
    linked: Boolean(
      settings.identities.find((row) => row.provider === provider)?.verifiedAt,
    ),
  }));

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-lg font-bold text-ink">
          {t("account.channels.whereToReachYou")}
        </h1>
        <p className="max-w-prose text-sm text-ink-3">
          {t("account.channels.yourRemindersAlwaysAppear")}
        </p>
      </header>

      <DeliveryForm
        action={saveDelivery}
        primaryChannel={settings.primaryChannel}
        quietHours={settings.quietHours ?? null}
        quietLabel={t("account.channels.quietHoursIn", {
          timezone: settings.timezone,
        })}
        quietDescription={t("account.channels.aReminderDueInside")}
        quietStartLabel={t("account.channels.quietStart")}
        quietEndLabel={t("account.channels.quietEnd")}
        choices={CHOICES.map((choice) => {
          const unavailable =
            choice.needsLink &&
            (!connected.has(choice.id as never) ||
              !linked.has(choice.id as never));
          return {
            id: choice.id,
            label: t(choice.labelKey),
            unavailableReason: unavailable
              ? connected.has(choice.id as never)
                ? t("account.channels.linkYourAccountFirst")
                : t("account.channels.notConnectedForThisWorkspace")
              : null,
          };
        })}
      />

      <Card data-testid="channels-linked-card">
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {t("account.channels.linkedAccounts")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("account.channels.linkedAccountsHint")}
            </p>
          </div>
          <span className="rounded-full bg-raised px-2 font-semibold text-ink-3 text-xs">
            {t("common.appliesAtOnce")}
          </span>
        </CardHeader>
        <CardBody>
          {tiles.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("account.channels.noChatProviderIs")}
            </p>
          ) : (
            <LinkedAccounts
              startLink={startLink}
              unlink={unlink}
              tiles={tiles}
            />
          )}
        </CardBody>
      </Card>

      <CadenceForm
        action={saveCadence}
        settings={cadence}
        timezone={settings.timezone}
        reasons={NOTIFICATION_REASONS.map((reason) => {
          const labelKey = REASON_LABELS[reason];
          return { id: reason, label: labelKey ? t(labelKey) : reason };
        })}
        channels={CHOICES.map((choice) => ({
          id: choice.id,
          label: t(choice.labelKey),
        }))}
      />
    </div>
  );
}
