import {
  ACCOUNT_DELETION_WAIT_DAYS,
  callAction,
  deletionCardFor,
  emailCardFor,
  isCloudEnabled,
  isDemoAccount,
} from "@openokr/core";
import { listTimezones } from "@openokr/formats";
import { Card, CardBody, CardHeader } from "@openokr/ui";
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
import { requestDeletion } from "./delete-actions.ts";
import { DeleteAccountCard } from "./delete-card.tsx";
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
 *
 * **At the foot, Delete your account** (Y7): the danger card, which says
 * why not or asks for the password. A sign-in that cancelled a deletion lands
 * here and says the account is kept.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    emailChange?: string;
    error?: string;
    deletion?: string;
  }>;
}) {
  const { t } = await getTranslations();
  const { session, workspace } = await requireWorkspace();
  const params = await searchParams;
  const opened = linkOutcome(params, session.user.email, t);
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const [member, directory, delivery, emailCard, deletionCard, cloud] =
    await Promise.all([
      callAction(context, "people.readMember", {
        memberId: workspace.memberId,
      }),
      callAction(context, "people.directory", {}),
      callAction(context, "channels.mySettings", {}),
      emailCardFor(getPool(), {
        userId: session.user.id,
        email: session.user.email,
        canSendMail: canSendMail(),
        sessionCreatedAt: session.session.createdAt,
      }),
      deletionCardFor(getPool(), {
        userId: session.user.id,
        email: session.user.email,
        sessionCreatedAt: session.session.createdAt,
      }),
      isCloudEnabled(getPool()).catch(() => false),
    ]);
  const demo = isDemoAccount(session.user.email);
  const manager = member.managerId
    ? (directory.find((one) => one.id === member.managerId) ?? null)
    : null;
  // The thumbnail, through the same access check as the file itself.
  const avatarUrl = member.avatarBlobId
    ? `/api/blobs/${member.avatarBlobId}/thumbnail`
    : null;

  const GROUP = "text-xs font-semibold uppercase tracking-wide text-ink-4";
  const readOnly =
    "flex h-7.5 items-center rounded-control bg-raised px-2.5 text-sm text-ink-2";

  return (
    <div className="flex flex-col gap-4" data-testid="your-account">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-bold text-ink text-lg">
            {t("account.profile.heading")}
          </h1>
          <p className="max-w-prose text-ink-3 text-sm">
            {t("account.profile.intro")}
          </p>
        </div>
        <Link
          href={`/people/${workspace.memberId}`}
          className="font-semibold text-brand-text text-xs hover:underline"
        >
          {t("account.profile.seeAsOthersDo")}
        </Link>
      </div>
      {params.deletion === "kept" ? (
        <p
          role="status"
          data-testid="deletion-kept"
          className="max-w-prose rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok"
        >
          {t("account.delete.kept")}
        </p>
      ) : null}

      <h2 className={GROUP}>{t("account.group.profile")}</h2>

      <NameForm
        name={member.name}
        action={updateOwnName}
        demo={demo}
        picture={
          <AvatarForm
            name={member.name}
            avatarUrl={avatarUrl}
            uploadAvatar={uploadAvatar}
            removeAvatar={removeAvatar}
          />
        }
      >
        <div className="col-span-12 flex flex-col gap-1 md:col-span-6">
          <span className="font-semibold text-ink-2 text-sm">
            {t("account.profile.jobTitle")}
          </span>
          <div className={readOnly}>
            {member.title ?? t("account.profile.none")}
          </div>
        </div>
        <div className="col-span-12 flex flex-col gap-1 md:col-span-6">
          <span className="font-semibold text-ink-2 text-sm">
            {t("common.manager")}
          </span>
          <div className={readOnly}>
            {manager?.name ?? t("account.profile.none")}
          </div>
        </div>
        <p className="col-span-12 text-ink-3 text-xs">
          {t("account.profile.setByAdministrator")}
        </p>
      </NameForm>

      <ProfileForm
        memberId={workspace.memberId}
        timezone={member.timezone}
        zones={listTimezones()}
        primaryChannel={member.primaryChannel}
        quietHours={delivery?.quietHours ?? null}
        bio={member.bio}
        updateProfile={updateProfile}
      />

      <h2 className={GROUP}>{t("account.group.preferences")}</h2>

      <Card>
        <CardHeader className="justify-between">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-semibold text-ink text-sm">
              {t("people.detail.appearance")}
            </h2>
            <p className="text-ink-3 text-xs">
              {t("people.detail.keptOnYouRather")}
            </p>
          </div>
          <span className="rounded-full bg-raised px-2 font-semibold text-ink-3 text-xs">
            {t("common.appliesAtOnce")}
          </span>
        </CardHeader>
        <CardBody>
          <AppearanceControl language={member.language} layout="grid" />
        </CardBody>
      </Card>

      <h2 className={GROUP}>{t("account.group.signIn")}</h2>

      <EmailCard
        card={emailCard}
        action={changeEmail}
        email={session.user.email}
        opened={opened}
      />

      <DeleteAccountCard
        card={deletionCard}
        days={ACCOUNT_DELETION_WAIT_DAYS}
        currentWorkspaceId={workspace.workspaceId}
        cloud={cloud}
        action={requestDeletion}
      />
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
