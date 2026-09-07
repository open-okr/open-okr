import { callAction } from "@openokr/core";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import { saveDelivery, startLink, unlink } from "./actions.ts";
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

const CHOICES = [
  { id: "app", label: "In the product only", needsLink: false },
  { id: "email", label: "Email", needsLink: false },
  { id: "slack", label: "Slack", needsLink: true },
  { id: "teams", label: "Microsoft Teams", needsLink: true },
  { id: "whatsapp", label: "WhatsApp", needsLink: true },
  { id: "telegram", label: "Telegram", needsLink: true },
] as const;

export default async function AccountChannelsPage() {
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

  const linked = new Set(
    settings.identities
      .filter((identity) => identity.verifiedAt !== null)
      .map((identity) => identity.provider),
  );
  const connected = new Set(settings.connected);

  return (
    <AppShellLayout>
      <div className="mx-auto flex max-w-xl flex-col gap-4.5">
        <Card>
          <CardHeader>
            <h1 className="text-lg font-bold text-ink">Where to reach you</h1>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-ink-3">
              Your reminders always appear in the product. This is where else
              they go.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Delivery</CardHeader>
          <CardBody>
            <LinkForm action={saveDelivery} className="flex flex-col gap-3">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-xs font-semibold text-ink-2">
                  Primary channel
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
                  Quiet hours, in {settings.timezone}
                </legend>
                <p className="text-xs text-ink-3">
                  A reminder due inside this window waits until it ends. An
                  escalation past the person who owns the work still comes
                  through.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    name="quietStart"
                    defaultValue={settings.quietHours?.start ?? ""}
                    className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                  />
                  <span className="text-xs text-ink-3">to</span>
                  <input
                    type="time"
                    name="quietEnd"
                    defaultValue={settings.quietHours?.end ?? ""}
                    className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                  />
                </div>
              </fieldset>

              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="w-fit"
              >
                Save
              </Button>
            </LinkForm>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>Linked accounts</CardHeader>
          <CardBody className="flex flex-col gap-3">
            {settings.connected.length === 0 ? (
              <p className="text-sm text-ink-3">
                No chat provider is connected for this workspace yet, so there
                is nothing to link. Email works without any of this.
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
                        <Chip tone="ok">linked</Chip>
                      ) : (
                        <Chip tone="neutral">not linked</Chip>
                      )}
                    </span>
                    {identity?.verifiedAt ? (
                      <LinkForm action={unlink}>
                        <input type="hidden" name="provider" value={provider} />
                        <Button type="submit" variant="ghost" size="sm">
                          Unlink
                        </Button>
                      </LinkForm>
                    ) : (
                      <LinkForm action={startLink}>
                        <input type="hidden" name="provider" value={provider} />
                        <Button type="submit" variant="default" size="sm">
                          Get a code
                        </Button>
                      </LinkForm>
                    )}
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
