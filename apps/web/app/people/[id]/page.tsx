import { ACCESS_LEVELS, callAction, renderRichTextToHtml } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAccessLevelFor } from "../../../lib/access";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
import { AppearanceControl } from "../../../lib/appearance.tsx";
import { FeedPanel } from "../../../lib/feed-panel.tsx";
import { getPool } from "../../../lib/pool";
import { requireWorkspace } from "../../../lib/workspace";
import { updateMemberFields, updateProfile } from "../actions.ts";
import { LifecycleControls } from "./lifecycle-controls.tsx";
import { ProfileForm } from "./profile-form.tsx";

/**
 * A member's profile (UIUX-PLAN.md SS6 S-33, P6-G09).
 *
 * Three view modes:
 * - Own profile: editable self fields (timezone, bio, channel, quiet hours)
 * - Others' profile: read-only
 * - Admin viewing others: editable org fields (name, title, manager)
 *
 * Lifecycle controls (suspend, restore, convert, erase) are P6-G10, and sit
 * below the admin edit card: they are the rarer thing to want and the one it
 * would be worse to press by accident.
 */

const CHANNEL_LABELS: Record<string, string> = {
  app: "In-app",
  email: "Email",
  slack: "Slack",
  teams: "Teams",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  /** The feed's cursor, which is the only thing this page reads (P6-G11b). */
  searchParams: Promise<{ at?: string; id?: string }>;
}) {
  const { id } = await params;
  const { session, workspace } = await requireWorkspace();
  const pool = getPool();
  const context = {
    pool,
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  // The feed for this surface (S-31, P6-G11b). Both halves of the cursor or
  // neither: a half cursor is a link somebody edited by hand.
  const feedParams = await searchParams;
  const feedCursor =
    feedParams.at && feedParams.id
      ? { at: feedParams.at, id: feedParams.id }
      : undefined;
  const [feedItems, feedDirectory, feedSettings] = await Promise.all([
    callAction(context, "activities.profileFeed", {
      memberId: id,
      ...(feedCursor ? { cursor: feedCursor } : {}),
    }),
    callAction(context, "people.directory", {}),
    callAction(context, "settings.readWorkspaceSettings", {}),
  ]);
  const feedNames = new Map(
    feedDirectory.map((member) => [member.id, member.name]),
  );

  let member: Awaited<ReturnType<typeof callAction<"people.readMember">>>;
  try {
    member = await callAction(context, "people.readMember", { memberId: id });
  } catch {
    notFound();
  }

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const isAdmin = level >= ACCESS_LEVELS.full;
  const isSelf = id === workspace.memberId;

  // Load additional data in parallel.
  const [goals, directory, possibleManagers] = await Promise.all([
    callAction(context, "goals.list", { includeClosed: false }),
    callAction(context, "people.directory", {}),
    isAdmin && !isSelf
      ? callAction(context, "people.possibleManagers", { memberId: id })
      : Promise.resolve([]),
  ]);

  const championed = goals.goals.filter((g) => g.champion.id === id);
  const directReports = directory.filter((m) => m.managerId === id);
  const manager = member.managerId
    ? (directory.find((m) => m.id === member.managerId) ?? null)
    : null;

  const bioHtml = member.bio ? renderRichTextToHtml(member.bio as never) : null;

  return (
    <AppShellLayout>
      <div className="flex flex-col gap-4.5">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-bg-2 text-lg font-bold text-ink-3">
                {member.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex min-w-0 flex-col">
                <h1 className="text-lg font-bold text-ink">{member.name}</h1>
                {member.title ? (
                  <p className="text-sm text-ink-3">{member.title}</p>
                ) : null}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {member.kind === "guest" ? (
                  <Chip tone="neutral">Guest</Chip>
                ) : null}
                {member.kind === "placeholder" ? (
                  <Chip tone="neutral">Placeholder</Chip>
                ) : null}
                {member.status === "suspended" ? (
                  <Chip tone="warn">Suspended</Chip>
                ) : null}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Profile details */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Profile</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {member.timezone ? (
                <>
                  <dt className="text-ink-3">Timezone</dt>
                  <dd className="text-ink">{member.timezone}</dd>
                </>
              ) : null}

              <dt className="text-ink-3">Prefers</dt>
              <dd className="text-ink">
                {CHANNEL_LABELS[member.primaryChannel ?? "app"] ?? "In-app"}
              </dd>

              {manager ? (
                <>
                  <dt className="text-ink-3">Manager</dt>
                  <dd>
                    <Link
                      href={`/people/${manager.id}`}
                      className="text-brand-text hover:underline"
                    >
                      {manager.name}
                    </Link>
                  </dd>
                </>
              ) : null}
            </dl>

            {bioHtml ? (
              <div className="mt-2 border-line border-t pt-3">
                <h3 className="mb-1 text-xs font-semibold text-ink-3">Bio</h3>
                <div
                  className="prose prose-sm max-w-none text-ink"
                  // The HTML is produced by renderRichTextToHtml, which is a
                  // sanitising allow-list at every surface (CLAUDE.md).
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by renderRichTextToHtml
                  dangerouslySetInnerHTML={{ __html: bioHtml }}
                />
              </div>
            ) : null}

            {isSelf ? (
              <div className="mt-2 border-line border-t pt-3">
                <Link
                  href="/account/channels"
                  className="text-xs font-semibold text-brand-text hover:underline"
                >
                  Manage your channels and notification preferences
                </Link>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* Direct reports */}
        {directReports.length > 0 ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                Direct reports ({directReports.length})
              </h2>
            </CardHeader>
            <CardBody>
              <ul className="flex flex-col gap-1">
                {directReports.map((report) => (
                  <li key={report.id}>
                    <Link
                      href={`/people/${report.id}`}
                      className="flex items-center gap-3 rounded-md px-3 py-1.5 hover:bg-bg-2"
                    >
                      <span className="font-medium text-ink">
                        {report.name}
                      </span>
                      {report.title ? (
                        <span className="text-sm text-ink-3">
                          {report.title}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        {/* Goals championed */}
        {championed.length > 0 ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                Goals championed ({championed.length})
              </h2>
            </CardHeader>
            <CardBody>
              <ul className="flex flex-col gap-1">
                {championed.map((goal) => (
                  <li key={goal.id}>
                    <Link
                      href={`/goals/${goal.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-3 py-1.5 hover:bg-bg-2"
                    >
                      <span className="text-sm text-ink">{goal.title}</span>
                      <Chip
                        tone={
                          goal.health === "on_track"
                            ? "brand"
                            : goal.health === "at_risk"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {goal.health.replace(/_/g, " ")}
                      </Chip>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        {/* How the product looks to this member (P6-G23). Their own profile
            only: a theme is a preference, not something an admin sets for
            somebody else. */}
        {isSelf ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Appearance</h2>
              <p className="text-xs text-ink-3">
                Kept on you rather than on this browser, so it follows you to
                another machine. The same control is in the account menu.
              </p>
            </CardHeader>
            <CardBody>
              <AppearanceControl language={member.language} />
            </CardBody>
          </Card>
        ) : null}

        {/* Self-edit form */}
        {isSelf ? (
          <ProfileForm
            memberId={id}
            timezone={member.timezone}
            primaryChannel={member.primaryChannel}
            updateProfile={updateProfile}
          />
        ) : null}

        {/* Admin org-field edit */}
        {isAdmin && !isSelf ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                Edit member (admin)
              </h2>
            </CardHeader>
            <CardBody>
              <form
                action={async (form: FormData) => {
                  "use server";
                  await updateMemberFields(null, form);
                }}
                className="flex flex-col gap-2"
              >
                <input type="hidden" name="memberId" value={id} />
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Name
                  <input
                    name="name"
                    defaultValue={member.name}
                    required
                    maxLength={200}
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Title
                  <input
                    name="title"
                    defaultValue={member.title ?? ""}
                    maxLength={200}
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Manager
                  <select
                    name="managerId"
                    defaultValue={member.managerId ?? ""}
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  >
                    <option value="">No manager</option>
                    {possibleManagers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
                >
                  Save
                </button>
              </form>
            </CardBody>
          </Card>
        ) : null}

        {/* Admin only, and shown on your own profile as well.
            `isLastFullAccessHolder` counts every other active member, and the
            caller already holds full to be here, so the last-owner refusal can
            only ever fire on yourself. Hiding this card on your own profile
            would make that invariant unreachable from the product, which is
            half of what B-08 was. A sole administrator leaving is exactly who
            needs to be told to hand over first. */}
        {isAdmin ? (
          <LifecycleControls
            memberId={id}
            memberName={member.name}
            status={member.status}
            kind={member.kind}
            isSelf={isSelf}
          />
        ) : null}

        <p className="text-xs text-ink-4">
          <Link href="/people" className="text-brand-text hover:underline">
            Back to the directory
          </Link>
        </p>
        <FeedPanel
          title="What they did"
          explains="This member's own activity, filtered to what you can see. Not what was done to them: being assigned a task is somebody else acting."
          items={feedItems}
          names={feedNames}
          timeZone={String(feedSettings.settings.timezone ?? "UTC")}
          basePath={`/people/${id}`}
          paged={feedCursor !== undefined}
          live={{ scope: "profile", subjectId: id }}
        />
      </div>
    </AppShellLayout>
  );
}
