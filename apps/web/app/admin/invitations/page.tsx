import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { intlTagFor } from "@openokr/formats";
import {
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmailInput,
  EntityPicker,
  NumberInput,
  TokenInput,
} from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { namedOption } from "../../../lib/entity-options.ts";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import {
  createGuestLinkAction,
  createPersonalLinkAction,
  createWorkspaceLinkAction,
} from "./actions";
import { InviteForm } from "./invite-form";
import { RevokeButton } from "./revoke-button";

export const generateMetadata = pageTitle("pageTitle.adminInvitations");

/**
 * Invitations (UIUX-PLAN.md §6 S-36, TECHNICAL-PLAN §4.1, P6-G06).
 *
 * **Until this existed, a self-hosted instance was a one-person instance.**
 * P2-T04 built the whole invitation funnel at P2-T04 and no screen ever reached
 * it: five registered actions, no caller anywhere in `apps/web`, and the words
 * "invite" and "invitation" appearing only in sign-up copy. Registration closes
 * after the first user (P1-T06), so the only way to add a second person was the
 * command line. The gap audit of 7 September 2026 recorded it as B-07.
 *
 * **Two shapes, because they answer different questions.** A personal link is
 * for one address and is used once, which is what an administrator wants when
 * they are inviting a named person. A workspace link is for a channel or a
 * document: anyone holding it may join, bounded by a use count, an expiry and
 * an optional domain list. Trusted-domain joining is a third path and lives on
 * the general card, because it is a property of the workspace rather than an
 * invitation somebody issued.
 *
 * **A guest is invited here too, since completeness review M-22.** A guest
 * could only be made by converting a member, which gave an outsider the whole
 * workspace in between. The guest card issues a personal invitation that
 * names one space; accepting makes a guest with nothing on the workspace and
 * `view` on that space.
 *
 * **A token is shown once.** The table holds its digest, which is what makes a
 * leaked list of invitations harmless, so the list below carries no tokens and
 * the form says "copy this now" before the button rather than after.
 */

/**
 * What a link is doing right now, in the order the states actually matter.
 * The label is a catalogue key, so the page says it in the reader's language.
 */
function stateOf(link: {
  revokedAt: string | null;
  expiresAt: string | null;
  useCount: number;
  maxUses: number | null;
}): { label: string; tone: "ok" | "neutral" | "warn" | "bad" } {
  if (link.revokedAt) {
    return { label: "admin.invitations.stateRevoked", tone: "bad" };
  }
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return { label: "admin.invitations.stateExpired", tone: "warn" };
  }
  if (link.maxUses !== null && link.useCount >= link.maxUses) {
    return { label: "admin.invitations.stateUsedUp", tone: "warn" };
  }
  return { label: "admin.invitations.stateOpen", tone: "ok" };
}

export default async function InvitationsPage() {
  const { t, locale } = await getTranslations();

  const shortDate = (value: string | null): string =>
    value
      ? new Intl.DateTimeFormat(intlTagFor(locale), {
          day: "numeric",
          month: "short",
          year: "numeric",
        }).format(new Date(value))
      : "";

  const header = (
    <header className="flex flex-col gap-1">
      <h1 className="text-lg font-bold text-ink">
        {t("admin.invitations.invitations")}
      </h1>
      <p className="max-w-prose text-sm text-ink-3">
        {t("admin.invitations.intro")}
      </p>
    </header>
  );

  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  // The layout already refuses below `full`. Checked again here because a
  // hidden control is cosmetic and this page names email addresses.
  if (level < ACCESS_LEVELS.full) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card>
          <CardBody>
            <p className="text-sm text-ink-3">
              {t("admin.invitations.onlyAWorkspaceAdministrator")}
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
  const [links, spaces] = await Promise.all([
    callAction(context, "invitations.list", {}),
    // The spaces a guest can be invited to, which an administrator sees all of
    // through the workspace's standard binding on every space.
    callAction(context, "spaces.list", {}),
  ]);
  const spaceNames = new Map(spaces.map((space) => [space.id, space.name]));

  return (
    <div className="flex flex-col gap-4">
      {header}
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {t("admin.invitations.inviteOnePerson")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("admin.invitations.oneAddressOneUse")}
            </p>
          </div>
        </CardHeader>
        <InviteForm
          action={createPersonalLinkAction}
          submitLabel={t("admin.invitations.createTheInvitation")}
          bodyClassName="grid grid-cols-12 gap-x-6 gap-y-4"
        >
          <div className="col-span-12 md:col-span-6">
            <EmailInput
              label={t("admin.invitations.emailAddress")}
              name="email"
              required
              placeholder={t("admin.invitations.nameExampleCom")}
            />
          </div>
          <div className="col-span-12 md:col-span-6">
            {/* 1 to 365, the server's range (guided-inputs §6). */}
            <NumberInput
              label={t("admin.invitations.expiresInDays")}
              name="expiresInDays"
              min={1}
              max={365}
              step={1}
              defaultValue={14}
            />
          </div>
        </InviteForm>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {t("admin.invitations.inviteAGuest")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("admin.invitations.aGuestSeesOne")}
            </p>
          </div>
        </CardHeader>
        {spaces.length === 0 ? (
          <CardBody>
            <p className="text-sm text-ink-3">
              {t("admin.invitations.noSpaceToInviteAGuestTo")}
            </p>
          </CardBody>
        ) : (
          <InviteForm
            action={createGuestLinkAction}
            submitLabel={t("admin.invitations.inviteTheGuest")}
            bodyClassName="grid grid-cols-12 gap-x-6 gap-y-4"
          >
            <div className="col-span-12 md:col-span-4">
              {/* Its own label, so the page never has two fields a person or
                      a screen reader would both call "Email address". */}
              <EmailInput
                label={t("admin.invitations.guestEmailAddress")}
                name="email"
                required
                placeholder={t("admin.invitations.nameExampleCom")}
              />
            </div>
            <div className="col-span-12 md:col-span-4">
              <EntityPicker
                label={t("admin.invitations.guestOf")}
                name="spaceId"
                required
                placeholder={t("admin.invitations.chooseTheSpace")}
                options={spaces.map(namedOption)}
              />
            </div>
            <div className="col-span-12 md:col-span-4">
              <NumberInput
                label={t("admin.invitations.expiresInDays")}
                name="expiresInDays"
                min={1}
                max={365}
                step={1}
                defaultValue={14}
              />
            </div>
          </InviteForm>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {t("admin.invitations.createALinkTo")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("admin.invitations.forAChannelOr")}
            </p>
          </div>
        </CardHeader>
        <InviteForm
          action={createWorkspaceLinkAction}
          submitLabel={t("admin.invitations.createTheLink")}
          bodyClassName="grid grid-cols-12 gap-x-6 gap-y-4"
        >
          <div className="col-span-12 md:col-span-6">
            <NumberInput
              label={t("admin.invitations.maximumUses")}
              name="maxUses"
              min={1}
              step={1}
              placeholder={t("admin.invitations.noLimit")}
            />
          </div>
          <div className="col-span-12 md:col-span-6">
            <NumberInput
              label={t("admin.invitations.expiresInDays")}
              name="expiresInDays"
              min={1}
              max={365}
              step={1}
              defaultValue={30}
            />
          </div>
          <div className="col-span-12">
            {/* Each domain a chip, checked by the rule trusted domains use
                  (guided-inputs §4.11). */}
            <TokenInput
              label={t("admin.invitations.allowedDomains")}
              name="allowedDomains"
              rule="domain"
              placeholder={t("admin.invitations.exampleComExampleOrg")}
              description={t("admin.invitations.leaveEmptyToAccept")}
            />
          </div>
        </InviteForm>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">
                {t("admin.invitations.issued")}
              </h2>
              <span className="rounded-full bg-raised px-2 text-xs font-semibold text-ink-3">
                {links.length}
              </span>
            </div>
            <p className="text-xs text-ink-3">
              {t("admin.invitations.revokedAndExpiredLinks")}
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {links.length === 0 ? (
            <p className="text-sm text-ink-3">
              {t("admin.invitations.nothingIssuedYetEverybody")}
            </p>
          ) : (
            <ul
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
              tabIndex={0}
              aria-label={t("admin.invitations.listLabel")}
              className="max-h-[296px] overflow-y-auto pe-1.5 overscroll-contain rounded-lg border border-line"
            >
              {links.map((link, index) => {
                const state = stateOf(link);
                const revocable = !link.revokedAt;
                // Each part is a whole phrase of its own, joined by the
                // separator, so no sentence is assembled from pieces.
                const details = [
                  link.memberKind === "guest"
                    ? t("admin.invitations.guestOfSpace", {
                        space:
                          (link.spaceId
                            ? spaceNames.get(link.spaceId)
                            : undefined) ??
                          t("admin.invitations.anArchivedSpace"),
                      })
                    : link.mode === "personal"
                      ? t("admin.invitations.modePersonal")
                      : t("workspaceSwitcher.workspace"),
                  link.maxUses === null
                    ? t("admin.invitations.uses", {
                        count: link.useCount,
                      })
                    : t("admin.invitations.usesOfMax", {
                        count: link.useCount,
                        max: link.maxUses,
                      }),
                  link.expiresAt
                    ? t("admin.invitations.expires", {
                        date: shortDate(link.expiresAt),
                      })
                    : null,
                  link.allowedDomains.length > 0
                    ? link.allowedDomains.join(", ")
                    : null,
                ]
                  .filter((part): part is string => part !== null)
                  .join(" · ");
                return (
                  <li
                    key={link.id}
                    className={`flex flex-wrap items-center justify-between gap-2.5 px-3 py-2.5 ${index === 0 ? "" : "border-line border-t"}`}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm text-ink">
                        {link.email ?? t("admin.invitations.anyoneWithTheLink")}
                      </span>
                      <span className="text-xs text-ink-4">{details}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Chip tone={state.tone}>{t(state.label)}</Chip>
                      {revocable ? <RevokeButton linkId={link.id} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
