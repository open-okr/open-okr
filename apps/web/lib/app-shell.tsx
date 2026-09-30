import { loadEnv } from "@openokr/config";
import {
  ACCESS_LEVELS,
  callAction,
  isCloudEnabled,
  navigationFor,
  OperationError,
} from "@openokr/core";
import {
  AppShell,
  Button,
  Card,
  CardBody,
  CycleStrip,
  KeyboardRegistryProvider,
  MobileTabBar,
  ShortcutOverlay,
  Sidebar,
  type SidebarGroup,
  Topbar,
  TopbarSearch,
  UnsavedChangesProvider,
} from "@openokr/ui";
import { Ellipsis, Settings } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { AvatarMenu } from "../app/avatar-menu.tsx";
import { copilotAvailabilityAction } from "../app/copilot/actions.ts";
import { CopilotPanel } from "../app/copilot/copilot-panel.tsx";
import {
  CommandPalette,
  type PaletteDestination,
} from "../app/search/palette.tsx";
import { SignOut } from "../app/sign-out.tsx";
import { WorkspaceSwitcher } from "../app/workspace-switcher.tsx";
import { resolveAccessLevelFor } from "./access.ts";
import { AppearanceControl, AppearanceSync } from "./appearance.tsx";
import { getAuth } from "./auth.ts";
import { loadCycleStrip } from "./cycle-strip-data.ts";
import { embedFor } from "./embedder";
import { loadInboxBadge } from "./inbox-badge.ts";
import { navBlocks, navLabel } from "./nav-groups.ts";
import { iconFor } from "./nav-icons.tsx";
import { getPool } from "./pool";
import { loadReviewBadge } from "./review-badge.ts";
import { ReviewBadgeLive } from "./review-badge-live.tsx";
import { SiteMessages } from "./site-messages.tsx";
import { StaleDeploymentWatcher } from "./stale-deployment-watcher.tsx";
import { SupportBanner } from "./support-banner.tsx";
import { getTranslations } from "./translations";
import { requireWorkspace } from "./workspace.ts";
import { workspaceTerms } from "./workspace-presentation.ts";
import { WorkspaceStateBanner } from "./workspace-state.tsx";

/**
 * The authenticated app shell (UIUX-PLAN.md §3, P2-T10). Every top-level
 * authenticated page wraps its content with this rather than the routes
 * sharing a `layout.tsx`: `app/page.tsx`, `app/admin/layout.tsx` and
 * `app/account/security/page.tsx` sit in different subtrees today and
 * moving them under one new route group to share a layout would touch
 * every relative import across three already-shipped tasks (P1-T08,
 * P2-T08, P2-T09) for no behavioural gain — a shared function composes
 * the same chrome without moving a single existing file.
 *
 * Icon mapping lives in `nav-icons.tsx`, not the registry: `NavigationItem`
 * (P2-T08) deliberately carries no icon field, because the registry is
 * DB-free, synchronous data and an icon is a presentation detail its
 * consumers (this file, one day a mobile client) each choose for
 * themselves. It moved out of this file so a test can assert the map covers
 * the registry without importing a server component.
 */

/**
 * Which navigation item the reader is on.
 *
 * The longest registered href that prefixes the current path wins, so
 * `/spaces/abc` marks Spaces rather than nothing, and `/` only ever matches
 * itself. The path arrives as a request header from `proxy.ts`, because a server
 * component cannot ask the router where it is.
 */
function activeItemId(
  path: string,
  items: readonly { id: string; href: string }[],
): string | null {
  let best: { id: string; href: string } | null = null;
  for (const item of items) {
    const matches =
      item.href === "/"
        ? path === "/"
        : path === item.href || path.startsWith(`${item.href}/`);
    if (matches && (!best || item.href.length > best.href.length)) {
      best = item;
    }
  }
  return best?.id ?? null;
}

function LinkComponent({
  href,
  className,
  children,
}: ComponentProps<typeof Link>) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export async function AppShellLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { session, workspace, memberships } = await requireWorkspace();

  // **A suspended member has a session and no access, and the two reads
  // below are the first place that finds out** (manual UAT, 29 September
  // 2026, M06-07): `access()`'s scoped getter correctly excludes them, which
  // is the design (CLAUDE.md: "returns not-found on forbidden and excludes
  // suspended members"), but nothing caught the `OperationError` this shell
  // wraps every authenticated page in, so it fell through to the framework's
  // generic error boundary. That boundary tells the reader "this is our
  // fault, not something you did", which is false here: it is a suspension
  // working exactly as designed, on every page the member tries next, not a
  // crash on one. Caught here instead, once, for the one thing every
  // authenticated page shares.
  async function loadMemberContext() {
    const resolvedLevel = await resolveAccessLevelFor(
      workspace.workspaceId,
      workspace.memberId,
    );
    // The member's own theme and density (P6-G23), applied to a browser that
    // has never seen them. Read here rather than in the root layout, because
    // the root wraps the signed-out screens too and they have no member.
    const member = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human" as const, userId: session.user.id },
      },
      "people.readMember",
      { memberId: workspace.memberId },
    );
    return { level: resolvedLevel, me: member };
  }

  let level: number;
  let me: Awaited<ReturnType<typeof loadMemberContext>>["me"];
  try {
    ({ level, me } = await loadMemberContext());
  } catch (error) {
    if (!(error instanceof OperationError)) {
      throw error;
    }
    const { t } = await getTranslations();
    async function signOutOfSuspendedWorkspace(): Promise<void> {
      "use server";
      await getAuth().api.signOut({ headers: await headers() });
      redirect("/sign-in");
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg p-4.5">
        <Card className="w-full max-w-sm">
          <CardBody className="flex flex-col gap-2.5">
            <h1 className="text-lg font-bold text-ink">
              {t("shell.suspended.title")}
            </h1>
            <p className="text-sm text-ink-2">{t("shell.suspended.body")}</p>
            <form action={signOutOfSuspendedWorkspace}>
              <Button type="submit" variant="default" size="sm">
                {t("shell.suspended.signOut")}
              </Button>
            </form>
          </CardBody>
        </Card>
      </main>
    );
  }

  const sidebarItems = navigationFor("sidebar", level);
  const adminItems = navigationFor("admin", level);
  const accountItems = sidebarItems.filter((item) => item.group === "account");

  const { t } = await getTranslations();
  const strip = await loadCycleStrip(
    workspace.workspaceId,
    session.user.id,
    level,
    t,
  );
  const reviewBadge = await loadReviewBadge(
    workspace.workspaceId,
    session.user.id,
    level,
  );
  const inboxBadge = await loadInboxBadge(
    workspace.workspaceId,
    session.user.id,
    level,
  );

  // Read here rather than inside the panel so the first open needs no round
  // trip, and so a provider-off workspace renders its own state on the server
  // instead of flashing an input it cannot use.
  const copilot = await copilotAvailabilityAction();
  // The same question for the palette's Related group (completeness review
  // M-21): asked here so a workspace with no embedding model, or one whose
  // egress controls keep retrieval here (M-10), sends no request for it at
  // all. Nothing is embedded by asking; this only resolves the provider.
  const semantic = (await embedFor(workspace.workspaceId)) !== undefined;

  const path = (await headers()).get("x-openokr-path") ?? "/";
  const active = activeItemId(path, [
    ...sidebarItems,
    { id: "admin", href: "/admin" },
  ]);

  // The workspace's own words for the method's terms (M-14), so a workspace
  // that calls a space a team reads Teams in its sidebar.
  const renamed = await workspaceTerms();

  // §3's separated blocks rather than one flat column. The split is the
  // registry's `group` field, read through `navBlocks` so the ordering and the
  // headings are testable without rendering a server component.
  const groups: SidebarGroup[] = navBlocks(sidebarItems, renamed).map(
    (block) => ({
      id: block.id,
      ...(block.label === undefined ? {} : { label: block.label }),
      items: block.items.map((item) => ({
        id: item.id,
        label: navLabel(item, renamed),
        href: item.href,
        icon: iconFor(item.id),
        active: item.id === active,
        // Two badges in the primary block since P6-G07a. Named per item rather
        // than looked up in a map, because each one comes from a different read
        // and a map would hide which.
        ...(item.id === "review" && reviewBadge !== null
          ? { badge: reviewBadge }
          : {}),
        ...(item.id === "inbox" && inboxBadge !== null
          ? { badge: inboxBadge }
          : {}),
      })),
    }),
  );
  // The pages the palette offers (completeness review M-21): the sidebar's,
  // the account's and the administration cards, from the same registry and
  // filtered by the same level, so the palette can open nothing the sidebar
  // would not. A cloud-only card is left out on a self-hosted instance, as the
  // admin layout leaves it out.
  const cloud = adminItems.some((item) => item.cloudOnly)
    ? await isCloudEnabled(getPool())
    : false;
  const paletteDestinations: PaletteDestination[] = [
    ...sidebarItems.map((item) => ({
      id: item.id,
      label: navLabel(item, renamed),
      href: item.href,
      area: item.group === "account" ? ("account" as const) : ("page" as const),
    })),
    ...adminItems
      .filter((item) => cloud || !item.cloudOnly)
      .map((item) => ({
        id: item.id,
        label: item.label,
        href: item.href,
        area: "admin" as const,
      })),
  ];

  const tabItems = sidebarItems.slice(0, 4).map((item) => ({
    id: item.id,
    label: navLabel(item, renamed),
    href: item.href,
    icon: iconFor(item.id),
    active: item.id === active,
  }));
  const tabIds = new Set(tabItems.map((item) => item.id));
  if (adminItems.length > 0) {
    groups.push({
      id: "admin",
      items: [
        {
          id: "admin",
          label: "Admin",
          href: "/admin",
          icon: <Settings className="size-full" />,
          active: active === "admin",
        },
      ],
    });
  }

  return (
    <KeyboardRegistryProvider>
      {/*
       * Around the whole shell rather than around each form, so a screen with
       * unsaved work asks once however many forms it holds, and so a form
       * added tomorrow is guarded without anybody remembering to mount
       * anything (P8-G11).
       */}
      <UnsavedChangesProvider message={t("common.unsavedChangesLeave")}>
        {/*
         * No `ToastProvider` here: it is in the root layout (M-13). Every
         * top-level screen renders its own copy of this shell, so a provider
         * here was replaced on every move between screens and took its toasts
         * with it. An undo offered on a task and shown on the board it sends
         * you back to has to outlive that move.
         */}

        <AppearanceSync theme={me.theme} density={me.density} />
        <AppShell
          skipToContentLabel={t("common.skipToContent")}
          sidebar={
            <Sidebar
              groups={groups}
              linkComponent={LinkComponent}
              workspaceSwitcher={
                <WorkspaceSwitcher
                  memberships={memberships}
                  active={workspace}
                />
              }
            />
          }
          topbar={
            <Topbar
              breadcrumb={workspace.name}
              search={<TopbarSearch />}
              askAi={<CopilotPanel initialAvailability={copilot} />}
              avatarMenu={
                <AvatarMenu
                  name={workspace.name}
                  // From the registry rather than a literal list. A literal one
                  // is how /account/channels shipped unlinked at P5-T02c and how
                  // /account/connections was still unlinked four tasks later:
                  // the page and the menu were two places to remember, and only
                  // one of them ever got opened. reachability.test.ts asserts
                  // the two agree.
                  items={accountItems.map((item) => ({
                    href: item.href,
                    label: item.label,
                  }))}
                  appearance={<AppearanceControl compact />}
                  signOut={<SignOut />}
                />
              }
            />
          }
          cycleStrip={
            strip ? (
              <CycleStrip
                phase={strip.phaseLabel}
                blocking={strip.blocking}
                due={strip.due}
              />
            ) : undefined
          }
          mobileTabBar={
            <MobileTabBar
              linkComponent={LinkComponent}
              items={tabItems}
              // Every other destination the sidebar holds, in its own
              // groups, because the sidebar is hidden at this width and a
              // phone had no other way to reach them (review H-16).
              more={{
                label: t("shell.mobile.more"),
                icon: <Ellipsis className="size-full" />,
                groups: groups
                  .map((group) => ({
                    id: group.id,
                    ...(group.label === undefined
                      ? {}
                      : { label: group.label }),
                    items: group.items.filter((item) => !tabIds.has(item.id)),
                  }))
                  .filter((group) => group.items.length > 0),
              }}
            />
          }
        >
          {/*
           * A workspace that is not taking writes says so on every screen
           * (P6-G25). Above the content rather than around it: reads are
           * unaffected by design and the admin recovery list has to stay
           * reachable, so this explains rather than blocks.
           */}
          {/* Somebody from outside the organisation is reading this workspace
           * right now (P8-T04b). First of the three, because it is the only
           * one that is about who is looking over the reader's shoulder, and
           * the only one that cannot be dismissed. */}
          <SupportBanner workspaceId={workspace.workspaceId} />
          {/* What the vendor is saying, above the workspace's own state
           * banner (P8-T03c). A site message is news from outside the
           * organisation and the state banner is a fact about the workspace,
           * so the outside one reads first. */}
          <SiteMessages
            userId={session.user.id}
            workspaceId={workspace.workspaceId}
          />
          {workspace.state === "active" ? null : (
            <div className="mb-4.5">
              <WorkspaceStateBanner
                state={workspace.state}
                canRecover={level >= ACCESS_LEVELS.full}
              />
            </div>
          )}
          {children}
        </AppShell>
        {/*
         * Beside the shell rather than inside the topbar, because the palette is
         * an overlay over the whole page. Mounted once here, so ⌘K works on every
         * screen without each one remembering to render it (P5-T13).
         */}
        <CommandPalette
          destinations={paletteDestinations}
          canCreateObjective={level >= ACCESS_LEVELS.edit}
          semantic={semantic}
        />
        {/* The Review count, kept current by the workspace's own feed
         * stream (completeness review M-32). Only for somebody who can
         * read the workspace, which is who the badge is drawn for. */}
        {level >= ACCESS_LEVELS.view ? (
          <ReviewBadgeLive count={reviewBadge} />
        ) : null}
        <ShortcutOverlay />
        <StaleDeploymentWatcher buildId={loadEnv().APP_BUILD_ID} />
      </UnsavedChangesProvider>
    </KeyboardRegistryProvider>
  );
}
