import { loadEnv } from "@openokr/config";
import {
  ACCESS_LEVELS,
  callAction,
  hasPlanScreen,
  isDemoAccount,
  liveSupportSession,
  mayCreateOwnWorkspace,
  navigationFor,
  OperationError,
  resolveSourceUrl,
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
  UnsavedChangesProvider,
} from "@openokr/ui";
import { Ellipsis } from "lucide-react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { type AccountBadge, AvatarMenu } from "../app/avatar-menu.tsx";
import { copilotAvailabilityAction } from "../app/copilot/actions.ts";
import { CopilotPanel } from "../app/copilot/copilot-panel.tsx";
import {
  CommandPalette,
  type PaletteDestination,
} from "../app/search/palette.tsx";
import { SignOut } from "../app/sign-out.tsx";
import { WorkspaceSwitcher } from "../app/workspace-switcher.tsx";
import { resolveAccessLevelFor } from "./access.ts";
import { ActivityIndicator } from "./activity-indicator.tsx";
import { AppFooter } from "./app-footer.tsx";
import { AppearanceControl, AppearanceSync } from "./appearance.tsx";
import { getAuth } from "./auth.ts";
import { brandingImageUrl } from "./branding-image.ts";
import { CreditsBanner } from "./credits-banner.tsx";
import { loadCycleStrip } from "./cycle-strip-data.ts";
import { seesCycle } from "./cycle-visibility.ts";
import { DemoPill } from "./demo-pill.tsx";
import { embedFor } from "./embedder";
import { readHold } from "./held-by.ts";
import { loadInboxBadge } from "./inbox-badge.ts";
import { getInstanceName } from "./instance-name";
import {
  builtinRoleLabel,
  navBlocks,
  navGroupLabel,
  navText,
} from "./nav-groups.ts";
import { iconFor } from "./nav-icons.tsx";
import { NavLink } from "./nav-link.tsx";
import { NewMenu } from "./new-menu.tsx";
import { getPool } from "./pool";
import { ProductTour } from "./product-tour.tsx";
import { loadReviewBadge } from "./review-badge.ts";
import { ReviewBadgeLive } from "./review-badge-live.tsx";
import { SidebarToggle } from "./sidebar-toggle.tsx";
import { SiteMessages } from "./site-messages.tsx";
import { StaleDeploymentWatcher } from "./stale-deployment-watcher.tsx";
import { SupportBanner } from "./support-banner.tsx";
import { TopbarSearchField } from "./topbar-search.tsx";
import { getTranslations } from "./translations";
import { requireWorkspace } from "./workspace.ts";
import {
  workspaceBrandImages,
  workspaceTerms,
} from "./workspace-presentation.ts";
import { TrialEndingBanner, WorkspaceStateBanner } from "./workspace-state.tsx";

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

/**
 * The mark beside the role in the avatar menu (plan 0.8.0 Y1), where it changes
 * what the person should expect: an operator inside a support session, a
 * guest, or an account `pnpm demo:prepare` made, whose address is one of the
 * personas' and can belong to nobody else (`@northwind.example`, RFC 2606).
 */
async function accountBadge(
  workspaceId: string,
  userId: string,
  email: string,
  kind: string,
): Promise<AccountBadge | null> {
  const support = await liveSupportSession(getPool(), workspaceId).catch(
    () => null,
  );
  if (support?.operatorUserId === userId) {
    return "support";
  }
  if (kind === "guest") {
    return "guest";
  }
  if (isDemoAccount(email)) {
    return "demo";
  }
  return null;
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
  // Screens reached from inside a module (P9-T07a-b): not drawn in the
  // sidebar, still offered by the palette, and lighting their parent's row.
  const insideItems = navigationFor("inside", level);
  const accountItems = sidebarItems.filter((item) => item.group === "account");

  // Cycle and the phase strip are for the people who run the cycle
  // (navigation-five-areas.md, OKRGoal UX review N3): from the spaces list the
  // reader already gets, and from whether they may set up a cycle, which plan
  // 0.8.0 R1 opened to an Admin (UAT 0.8.0, F-03).
  const spaceRoles = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "spaces.list",
    {},
  )
    .then((spaces) => spaces.map((space) => space.ownRole))
    .catch((error: unknown) => {
      if (error instanceof OperationError) {
        return [];
      }
      throw error;
    });
  const setsUpCycle = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "cycles.setupAccess",
    {},
  )
    .then((access) => access.canSetUp)
    .catch((error: unknown) => {
      if (error instanceof OperationError) {
        return false;
      }
      throw error;
    });
  // Whether this member may create an objective at all, the floor
  // `goals.create` runs (workspace-roles.md §13, UAT 0.8.0 F-04). The
  // workspace level below is `edit` for everybody, a Viewer included.
  const createsGoals = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "goals.createAccess",
    {},
  )
    .then((access) => access.canCreate)
    .catch((error: unknown) => {
      if (error instanceof OperationError) {
        return false;
      }
      throw error;
    });
  const runsCycle = seesCycle({
    administers: adminItems.length > 0,
    setsUpCycle,
    spaceRoles,
  });
  // The rows the sidebar draws: the five areas, and Cycle for those who run
  // it. The account rows live in the avatar menu, as the review asked.
  const drawnItems = sidebarItems.filter(
    (item) => item.group !== "account" && (item.id !== "cycle" || runsCycle),
  );

  const { t } = await getTranslations();
  const strip = runsCycle
    ? await loadCycleStrip(workspace.workspaceId, session.user.id, level, t)
    : null;
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
  // instead of flashing an input it cannot use. It never throws past the
  // session check (plan 0.8.1 CP8): a failure is the copilot unavailable,
  // never this page.
  const copilot = await copilotAvailabilityAction();
  // The same question for the palette's Related group (completeness review
  // M-21): asked here so a workspace with no embedding model, or one whose
  // egress controls keep retrieval here (M-10), sends no request for it at
  // all. Nothing is embedded by asking; this only resolves the provider.
  const semantic = (await embedFor(workspace.workspaceId)) !== undefined;

  const path = (await headers()).get("x-openokr-path") ?? "/";
  const active = activeItemId(path, [
    ...sidebarItems,
    ...insideItems.map((item) => ({
      id: item.parent ?? item.id,
      href: item.href,
    })),
    { id: "admin", href: "/admin" },
  ]);

  // The workspace's own words for the method's terms (M-14), so a workspace
  // that calls a space a team reads Teams in its sidebar.
  const renamed = await workspaceTerms();

  // §3's separated blocks rather than one flat column. The split is the
  // registry's `group` field, read through `navBlocks` so the ordering and the
  // headings are testable without rendering a server component.
  // Updates carries one badge: what is owed plus what is unread
  // (navigation-five-areas.md).
  const updatesBadge =
    reviewBadge === null && inboxBadge === null
      ? null
      : (reviewBadge ?? 0) + (inboxBadge ?? 0);
  const groups: SidebarGroup[] = navBlocks(drawnItems, renamed).map(
    (block) => ({
      id: block.id,
      ...(block.label === undefined
        ? {}
        : { label: navGroupLabel(block.id, t) ?? block.label }),
      items: block.items.map((item) => ({
        id: item.id,
        label: navText(item, t, renamed),
        href: item.href,
        icon: iconFor(item.id),
        active: item.id === active,
        // Two badges in the primary block since P6-G07a. Named per item rather
        // than looked up in a map, because each one comes from a different read
        // and a map would hide which.
        ...(item.id === "review" && updatesBadge !== null
          ? {
              badge: updatesBadge,
              badgeLabel: t("nav.updatesBadge", {
                owed: reviewBadge ?? 0,
                unread: inboxBadge ?? 0,
              }),
            }
          : {}),
      })),
    }),
  );
  // The pages the palette offers (completeness review M-21): the sidebar's,
  // the account's and the administration cards, from the same registry and
  // filtered by the same level, so the palette can open nothing the sidebar
  // would not. The plan card is left out with no plans to read, as the admin layout
  // leaves it out.
  const plans = adminItems.some((item) => item.needsPlans)
    ? await hasPlanScreen(getPool())
    : false;
  const paletteDestinations: PaletteDestination[] = [
    ...sidebarItems.map((item) => ({
      id: item.id,
      label: navText(item, t, renamed),
      href: item.href,
      area: item.group === "account" ? ("account" as const) : ("page" as const),
    })),
    ...insideItems.map((item) => ({
      id: item.id,
      label: navText(item, t, renamed),
      href: item.href,
      area: "page" as const,
    })),
    ...adminItems
      .filter((item) => plans || !item.needsPlans)
      .map((item) => ({
        id: item.id,
        label: navText(item, t),
        href: item.href,
        area: "admin" as const,
      })),
  ];

  const tabItems = drawnItems.slice(0, 4).map((item) => ({
    id: item.id,
    label: navText(item, t, renamed),
    href: item.href,
    icon: iconFor(item.id),
    active: item.id === active,
  }));
  const tabIds = new Set(tabItems.map((item) => item.id));
  // Admin is in the avatar menu since the five areas, beside the account
  // rows, for those who reach it.
  const avatarItems = [
    ...accountItems.map((item) => ({
      href: item.href,
      label: navText(item, t),
    })),
    ...(adminItems.length > 0
      ? [
          // The first card directly: `/admin` redirects only after the shell
          // has rendered, which drew every admin visit twice.
          { href: "/admin/general", label: t("shell.avatar.workspaceAdmin") },
        ]
      : []),
    // Only where sign-up is open to this person, because anywhere else the page
    // it opens is not-found (docs/design/hosting-profiles.md §3).
    ...((await mayCreateOwnWorkspace(getPool(), session.user.email))
      ? [{ href: "/workspaces/new", label: t("shell.avatar.newWorkspace") }]
      : []),
  ];

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
              linkComponent={NavLink}
              footer={<SidebarToggle />}
              workspaceSwitcher={
                <WorkspaceSwitcher
                  memberships={memberships}
                  active={workspace}
                  logoUrl={brandingImageUrl(
                    (await workspaceBrandImages()).logoBlobId,
                  )}
                />
              }
            />
          }
          topbar={
            <Topbar
              breadcrumb={workspace.name}
              // A demonstration instance says so on every screen, not only on
              // sign-in (plan 0.8.0 D1). The same variable the persona panel
              // reads, and nothing else.
              badge={loadEnv().OPENOKR_DEMO === "on" ? <DemoPill /> : undefined}
              search={<TopbarSearchField />}
              // UIUX-PLAN §3's `+ New`: a menu of what this member may
              // create, the same on every screen (lib/new-menu.tsx). Somebody
              // who cannot write is not offered it.
              newAction={
                level >= ACCESS_LEVELS.edit ? (
                  <NewMenu
                    items={[
                      ...(createsGoals
                        ? [
                            {
                              key: "objective",
                              label: t("newMenu.objective"),
                              icon: iconFor("goals"),
                              href: "/goals?new=objective",
                              screens: ["/goals", "/cycle", "/map"],
                            },
                          ]
                        : []),
                      {
                        key: "initiative",
                        label: t("newMenu.initiative"),
                        icon: iconFor("initiatives"),
                        href: "/initiatives#title",
                        screens: ["/initiatives"],
                      },
                      {
                        key: "task",
                        label: t("newMenu.task"),
                        icon: iconFor("board"),
                        href: "/board#title",
                        screens: ["/board", "/tasks"],
                      },
                      {
                        key: "kpi",
                        label: t("newMenu.kpi"),
                        icon: iconFor("kpis"),
                        href: "/kpis?new=kpi",
                        screens: ["/kpis"],
                      },
                      {
                        key: "session",
                        label: t("newMenu.session"),
                        icon: iconFor("sessions"),
                        href: "/sessions#schedule",
                        screens: ["/sessions", "/session"],
                      },
                      ...(level >= ACCESS_LEVELS.full
                        ? [
                            {
                              key: "space",
                              label: t("newMenu.space"),
                              icon: iconFor("spaces"),
                              href: "/spaces#space-name",
                              screens: ["/spaces"],
                            },
                            {
                              key: "invite",
                              label: t("newMenu.invite"),
                              icon: iconFor("admin-invitations"),
                              href: "/admin/invitations",
                              screens: ["/admin/invitations", "/people"],
                            },
                          ]
                        : []),
                    ]}
                  />
                ) : undefined
              }
              askAi={<CopilotPanel initialAvailability={copilot} />}
              avatarMenu={
                <AvatarMenu
                  // The person, not the workspace (plan 0.8.0 Y1): the circle
                  // drew the workspace's initials and nothing said who was
                  // signed in. The workspace's name stays in the breadcrumb.
                  name={me.name}
                  avatarUrl={
                    me.avatarBlobId
                      ? `/api/blobs/${me.avatarBlobId}/thumbnail`
                      : null
                  }
                  email={session.user.email}
                  roleName={builtinRoleLabel(me.roleKey, me.roleName, t)}
                  badge={
                    await accountBadge(
                      workspace.workspaceId,
                      session.user.id,
                      session.user.email,
                      me.kind,
                    )
                  }
                  sourceUrl={await resolveSourceUrl(getPool())}
                  // From the registry rather than a literal list. A literal one
                  // is how /account/channels shipped unlinked at P5-T02c and how
                  // /account/connections was still unlinked four tasks later:
                  // the page and the menu were two places to remember, and only
                  // one of them ever got opened. reachability.test.ts asserts
                  // the two agree.
                  items={avatarItems}
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
              linkComponent={NavLink}
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
          <CreditsBanner workspaceId={workspace.workspaceId} />
          {/* What the vendor is saying, above the workspace's own state
           * banner (P8-T03c). A site message is news from outside the
           * organisation and the state banner is a fact about the workspace,
           * so the outside one reads first. */}
          <SiteMessages
            userId={session.user.id}
            workspaceId={workspace.workspaceId}
          />
          {workspace.state === "active" && level >= ACCESS_LEVELS.full ? (
            <div className="mb-4.5 empty:hidden">
              <TrialEndingBanner workspaceId={workspace.workspaceId} />
            </div>
          ) : null}
          {workspace.state === "active" ? null : (
            <div className="mb-4.5">
              <WorkspaceStateBanner
                state={workspace.state}
                canRecover={level >= ACCESS_LEVELS.full}
                hold={await readHold(workspace.workspaceId)}
              />
            </div>
          )}
          {/* The version sits at the foot of the content, on the right
              (docs/design/version-footer.md §3). At least the pane's height,
              so it rests at the bottom of a short screen rather than under
              its last line. */}
          <div className="flex min-h-full flex-col">
            <div className="flex-1">{children}</div>
            <AppFooter
              level={level}
              instanceName={await getInstanceName()}
              askAvailable={copilot.available}
            />
          </div>
        </AppShell>
        {/* Mounted once, so every save, create, edit and refresh on every
         * screen shows the bar without each form remembering to (UIUX-PLAN
         * §4, "Acting"). */}
        <ActivityIndicator />
        {/* The product tour on a first sign-in, on whatever screen it lands
         * (plan 0.8.0 T1). Beside the shell because it dims all of it.
         * Onboarding (S-34) is outside the shell, so the tour comes after it,
         * never on top of it. */}
        <ProductTour
          offered={
            !(
              await callAction(
                {
                  pool: getPool(),
                  workspaceId: workspace.workspaceId,
                  actor: { kind: "human" as const, userId: session.user.id },
                },
                "people.readOwnTour",
                {},
              ).catch(() => ({ finished: true }))
            ).finished
          }
          demo={loadEnv().OPENOKR_DEMO === "on"}
          canDraft={createsGoals}
          askAvailable={copilot.available}
          instanceName={await getInstanceName()}
        />
        {/*
         * Beside the shell rather than inside the topbar, because the palette is
         * an overlay over the whole page. Mounted once here, so ⌘K works on every
         * screen without each one remembering to render it (P5-T13).
         */}
        <CommandPalette
          destinations={paletteDestinations}
          canCreateObjective={createsGoals}
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
