import { loadEnv } from "@openokr/config";
import { ACCESS_LEVELS, callAction, navigationFor } from "@openokr/core";
import {
  AppShell,
  CycleStrip,
  KeyboardRegistryProvider,
  MobileTabBar,
  ShortcutOverlay,
  Sidebar,
  type SidebarGroup,
  Topbar,
  TopbarSearch,
} from "@openokr/ui";
import { Settings } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AvatarMenu } from "../app/avatar-menu.tsx";
import { copilotAvailabilityAction } from "../app/copilot/actions.ts";
import { CopilotPanel } from "../app/copilot/copilot-panel.tsx";
import { CommandPalette } from "../app/search/palette.tsx";
import { SignOut } from "../app/sign-out.tsx";
import { WorkspaceSwitcher } from "../app/workspace-switcher.tsx";
import { resolveAccessLevelFor } from "./access.ts";
import { AppearanceControl, AppearanceSync } from "./appearance.tsx";
import { loadCycleStrip } from "./cycle-strip-data.ts";
import { loadInboxBadge } from "./inbox-badge.ts";
import { navBlocks } from "./nav-groups.ts";
import { iconFor } from "./nav-icons.tsx";
import { getPool } from "./pool";
import { loadReviewBadge } from "./review-badge.ts";
import { StaleDeploymentWatcher } from "./stale-deployment-watcher.tsx";
import { getTranslations } from "./translations";
import { requireWorkspace } from "./workspace.ts";
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
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const sidebarItems = navigationFor("sidebar", level);
  const adminItems = navigationFor("admin", level);
  const accountItems = sidebarItems.filter((item) => item.group === "account");
  // The member's own theme and density (P6-G23), applied to a browser that
  // has never seen them. Read here rather than in the root layout, because
  // the root wraps the signed-out screens too and they have no member.
  const me = await callAction(
    {
      pool: getPool(),
      workspaceId: workspace.workspaceId,
      actor: { kind: "human" as const, userId: session.user.id },
    },
    "people.readMember",
    { memberId: workspace.memberId },
  );

  const strip = await loadCycleStrip(
    workspace.workspaceId,
    session.user.id,
    level,
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

  const { t } = await getTranslations();
  const path = (await headers()).get("x-openokr-path") ?? "/";
  const active = activeItemId(path, [
    ...sidebarItems,
    { id: "admin", href: "/admin" },
  ]);

  // §3's separated blocks rather than one flat column. The split is the
  // registry's `group` field, read through `navBlocks` so the ordering and the
  // headings are testable without rendering a server component.
  const groups: SidebarGroup[] = navBlocks(sidebarItems).map((block) => ({
    id: block.id,
    ...(block.label === undefined ? {} : { label: block.label }),
    items: block.items.map((item) => ({
      id: item.id,
      label: item.label,
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
  }));
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
      <AppearanceSync theme={me.theme} density={me.density} />
      <AppShell
        skipToContentLabel={t("common.skipToContent")}
        sidebar={
          <Sidebar
            groups={groups}
            linkComponent={LinkComponent}
            workspaceSwitcher={
              <WorkspaceSwitcher memberships={memberships} active={workspace} />
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
              dueInDays={strip.dueInDays}
            />
          ) : undefined
        }
        mobileTabBar={
          <MobileTabBar
            linkComponent={LinkComponent}
            items={sidebarItems.slice(0, 4).map((item) => ({
              id: item.id,
              label: item.label,
              href: item.href,
              icon: iconFor(item.id),
              active: item.id === active,
            }))}
          />
        }
      >
        {/*
         * A workspace that is not taking writes says so on every screen
         * (P6-G25). Above the content rather than around it: reads are
         * unaffected by design and the admin recovery list has to stay
         * reachable, so this explains rather than blocks.
         */}
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
      <CommandPalette />
      <ShortcutOverlay />
      <StaleDeploymentWatcher buildId={loadEnv().APP_BUILD_ID} />
    </KeyboardRegistryProvider>
  );
}
