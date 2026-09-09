import { callAction } from "@openokr/core";
import { NOTIFICATION_REASONS } from "@openokr/db";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import { saveCadence, saveDelivery, startLink, unlink } from "./actions.ts";
import { CadenceForm } from "./cadence-form.tsx";
import { LinkForm } from "./link-form.tsx";

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
 * The labels are here because they are wording; the list is not.
 */
const REASON_LABELS: Readonly<Record<string, string>> = {
  mentioned: "Somebody mentions me",
  review: "A check-in is waiting on my review",
  check_in: "A reminder from the Champion or the Coach",
  invited: "An invitation",
  joined: "Somebody joins the workspace",
  role: "My role changes",
};

const CHOICES = [
  { id: "app", label: "In the product only", needsLink: false },
  { id: "email", label: "Email", needsLink: false },
  { id: "slack", label: "Slack", needsLink: true },
  { id: "teams", label: "Microsoft Teams", needsLink: true },
  { id: "whatsapp", label: "WhatsApp", needsLink: true },
  { id: "telegram", label: "Telegram", needsLink: true },
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

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4.5">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-bold text-ink">
            {t("account.channels.whereToReachYou")}
          </h1>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-ink-3">
            {t("account.channels.yourRemindersAlwaysAppear")}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("account.channels.delivery")}</CardHeader>
        <CardBody>
          <LinkForm action={saveDelivery} className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-semibold text-ink-2">
                {t("common.primaryChannel")}
              </legend>
              {CHOICES.map((choice) => {
                const unavailable =
                  choice.needsLink &&
                  (!connected.has(choice.id as never) ||
                    !linked.has(choice.id as never));
                return (
                  <label
                    key={choice.id}
                    className="flex items-center gap-2 text-sm text-ink"
                  >
                    <input
                      type="radio"
                      name="primaryChannel"
                      value={choice.id}
                      defaultChecked={settings.primaryChannel === choice.id}
                      disabled={unavailable}
                    />
                    {choice.label}
                    {unavailable ? (
                      <span className="text-xs text-ink-3">
                        {connected.has(choice.id as never)
                          ? "link your account first"
                          : "not connected for this workspace"}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-semibold text-ink-2">
                {t("account.channels.quietHoursIn")} {settings.timezone}
              </legend>
              <p className="text-xs text-ink-3">
                {t("account.channels.aReminderDueInside")}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  name="quietStart"
                  defaultValue={settings.quietHours?.start ?? ""}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
                <span className="text-xs text-ink-3">{t("common.to")}</span>
                <input
                  type="time"
                  name="quietEnd"
                  defaultValue={settings.quietHours?.end ?? ""}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                />
              </div>
            </fieldset>

            <Button type="submit" variant="primary" size="sm" className="w-fit">
              {t("common.save")}
            </Button>
          </LinkForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>{t("account.channels.linkedAccounts")}</CardHeader>
        <CardBody className="flex flex-col gap-3">
          {settings.connected.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("account.channels.noChatProviderIs")}
            </p>
          ) : (
            settings.connected.map((provider) => {
              const identity = settings.identities.find(
                (row) => row.provider === provider,
              );
              return (
                <div
                  key={provider}
                  className="flex flex-col gap-1.5 rounded-lg border border-line p-3"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {provider}
                    {identity?.verifiedAt ? (
                      <Chip tone="ok">{t("account.channels.linked")}</Chip>
                    ) : (
                      <Chip tone="neutral">
                        {t("account.channels.notLinked")}
                      </Chip>
                    )}
                  </span>
                  {identity?.verifiedAt ? (
                    <LinkForm action={unlink}>
                      <input type="hidden" name="provider" value={provider} />
                      <Button type="submit" variant="ghost" size="sm">
                        {t("common.unlink")}
                      </Button>
                    </LinkForm>
                  ) : (
                    <LinkForm action={startLink}>
                      <input type="hidden" name="provider" value={provider} />
                      <Button type="submit" variant="default" size="sm">
                        {t("account.channels.getACode")}
                      </Button>
                    </LinkForm>
                  )}
                </div>
              );
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("account.channels.howOften")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("account.channels.theMemberHalfOf")}
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <CadenceForm
            action={saveCadence}
            settings={cadence}
            reasons={NOTIFICATION_REASONS.map((reason) => ({
              id: reason,
              label: REASON_LABELS[reason] ?? reason,
            }))}
            channels={CHOICES.map((choice) => ({
              id: choice.id,
              label: choice.label,
            }))}
          />
        </CardBody>
      </Card>
    </div>
  );
}
