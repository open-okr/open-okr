import { callAction, emailCardFor, isDemoAccount } from "@openokr/core";
import { listTimezones } from "@openokr/formats";
import { Avatar, Card, CardBody, CardHeader } from "@openokr/ui";
import Link from "next/link";
import { AppearanceControl } from "../../lib/appearance.tsx";
import { canSendMail, getPool } from "../../lib/auth";
import { pageTitle } from "../../lib/page-title.ts";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { AvatarForm } from "../people/[id]/avatar-form.tsx";
import { ProfileForm } from "../people/[id]/profile-form.tsx";
import {
  removeAvatar,
  updateOwnName,
  updateProfile,
  uploadAvatar,
} from "../people/actions.ts";
import { changeEmail } from "./email-actions.ts";
import { EmailCard } from "./email-card.tsx";
import { NameForm } from "./name-form.tsx";

export const generateMetadata = pageTitle("pageTitle.account");

/**
 * Your account (screen S-51, plan 0.8.0 Y2): where a person sees and changes
 * what is theirs.
 *
 * Before this, the self-edit forms sat on the person's own `/people/<id>`,
 * reached only through the people directory, and nothing in the avatar menu
 * led there. They live here now (Q5), and `/people/<id>` is what other people
 * see, with an Edit link for its owner.
 *
 * **Who they are in this workspace**: picture, name, title and manager, then
 * the profile form (time zone, how to reach them, bio) and appearance (theme,
 * density, language). The name is theirs to change (plan 0.8.0 Y5); title
 * and manager stay read only, because an administrator sets them. A
 * demonstration account keeps its name, because anybody can sign in to it.
 *
 * **How they sign in**: their email, which they change here (Y4), and
 * Security for the password (Y3). An opened change link lands back here, and
 * says what became of it.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ emailChange?: string; error?: string }>;
}) {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const opened = linkOutcome(await searchParams, session.user.email, t);
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const [member, directory, delivery, emailCard] = await Promise.all([
    callAction(context, "people.readMember", { memberId: workspace.memberId }),
    callAction(context, "people.directory", {}),
    callAction(context, "channels.mySettings", {}),
    emailCardFor(getPool(), {
      userId: session.user.id,
      email: session.user.email,
      canSendMail: canSendMail(),
      sessionCreatedAt: session.session.createdAt,
    }),
  ]);
  const demo = isDemoAccount(session.user.email);
  const manager = member.managerId
    ? (directory.find((one) => one.id === member.managerId) ?? null)
    : null;
  // The thumbnail, through the same access check as the file itself.
  const avatarUrl = member.avatarBlobId
    ? `/api/blobs/${member.avatarBlobId}/thumbnail`
    : null;

  return (
    <div className="flex flex-col gap-4.5" data-testid="your-account">
      <Card>
        <CardHeader className="justify-between">
          <h1 className="text-lg font-bold text-ink">
            {t("account.profile.heading")}
          </h1>
          <Link
            href={`/people/${workspace.memberId}`}
            className="text-xs font-semibold text-brand-text hover:underline"
          >
            {t("account.profile.seeAsOthersDo")}
          </Link>
        </CardHeader>
        <CardBody className="flex items-start gap-3">
          <Avatar name={member.name} src={avatarUrl ?? undefined} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {demo ? (
              <div className="flex flex-col gap-1 text-sm">
                <p>
                  <span className="text-ink-3">{t("common.name")} </span>
                  <span className="text-ink" data-testid="account-name">
                    {member.name}
                  </span>
                </p>
                <p className="text-xs text-ink-3">
                  {t("account.profile.demoKeepsName")}
                </p>
              </div>
            ) : (
              <NameForm name={member.name} action={updateOwnName} />
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-3">{t("account.profile.jobTitle")}</dt>
              <dd className="text-ink">
                {member.title ?? t("account.profile.none")}
              </dd>
              <dt className="text-ink-3">{t("common.manager")}</dt>
              <dd className="text-ink">
                {manager?.name ?? t("account.profile.none")}
              </dd>
            </dl>
          </div>
        </CardBody>
        <CardBody className="border-line border-t pt-3 text-xs text-ink-3">
          {t("account.profile.setByAdministrator")}
        </CardBody>
      </Card>

      <AvatarForm
        name={member.name}
        avatarUrl={avatarUrl}
        uploadAvatar={uploadAvatar}
        removeAvatar={removeAvatar}
      />
      <ProfileForm
        memberId={workspace.memberId}
        timezone={member.timezone}
        zones={listTimezones()}
        primaryChannel={member.primaryChannel}
        quietHours={delivery?.quietHours ?? null}
        bio={member.bio}
        updateProfile={updateProfile}
      />

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("people.detail.appearance")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("people.detail.keptOnYouRather")}
          </p>
        </CardHeader>
        <CardBody>
          <AppearanceControl language={member.language} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("account.profile.signIn")}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-3 text-sm">
          <p>
            <span className="text-ink-3">{t("account.profile.email")} </span>
            <span className="text-ink" data-testid="account-email">
              {session.user.email}
            </span>
          </p>
          <div role="status" aria-live="polite" className="contents">
            {opened ? (
              <p
                data-testid="email-change-outcome"
                className={
                  opened.ok
                    ? "max-w-prose rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok"
                    : "max-w-prose rounded-md bg-bad-bg px-2.5 py-1.5 text-xs font-medium text-bad"
                }
              >
                {opened.message}
              </p>
            ) : null}
          </div>
          <EmailCard card={emailCard} action={changeEmail} />
          <Link
            href="/account/security"
            className="text-xs font-semibold text-brand-text hover:underline"
          >
            {t("account.profile.passwordAndSessions")}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * What became of an opened change link (account-self-service.md §5, D19).
 * Better Auth lands a refused link on its callback with `error`, and the
 * completion hook lands its own refusals with the reason in `emailChange`.
 * The new address is never in the address bar: "taken" names no address.
 */
function linkOutcome(
  params: { readonly emailChange?: string; readonly error?: string },
  email: string,
  t: Awaited<ReturnType<typeof getTranslations>>["t"],
): { readonly ok: boolean; readonly message: string } | null {
  if (params.emailChange === undefined) {
    return null;
  }
  if (params.error !== undefined) {
    switch (params.error) {
      case "TOKEN_EXPIRED":
        return { ok: false, message: t("account.email.linkExpired") };
      case "INVALID_USER":
        return { ok: false, message: t("account.email.linkOtherAccount") };
      default:
        return { ok: false, message: t("account.email.linkInvalid") };
    }
  }
  switch (params.emailChange) {
    case "changed":
      return { ok: true, message: t("account.email.changed", { email }) };
    case "taken":
      return { ok: false, message: t("account.email.linkTaken") };
    case "demo":
      return { ok: false, message: t("account.email.linkDemo") };
    case "directory":
      return { ok: false, message: t("account.email.linkDirectory") };
    case "enforced":
      return { ok: false, message: t("account.email.linkEnforced") };
    case "company":
      return { ok: false, message: t("account.email.linkCompany") };
    default:
      return null;
  }
}
