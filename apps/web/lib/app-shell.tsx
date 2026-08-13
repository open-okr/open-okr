import { loadEnv } from "@openokr/config";
import { navigationFor } from "@openokr/core";
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
import {
  CheckCircle2,
  ClipboardCheck,
  Home,
  Inbox,
  RefreshCw,
  Settings,
  Shield,
  Target,
} from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AvatarMenu } from "../app/avatar-menu.tsx";
import { SignOut } from "../app/sign-out.tsx";
import { WorkspaceSwitcher } from "../app/workspace-switcher.tsx";
import { resolveAccessLevelFor } from "./access.ts";
import { loadCycleStrip } from "./cycle-strip-data.ts";
import { loadReviewBadge } from "./review-badge.ts";
import { StaleDeploymentWatcher } from "./stale-deployment-watcher.tsx";
import { requireWorkspace } from "./workspace.ts";

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
 * Icon mapping is local to this file, not the registry: `NavigationItem`
 * (P2-T08) deliberately carries no icon field, because the registry is
 * DB-free, synchronous data and an icon is a presentation detail its
 * consumers (this file, one day a mobile client) each choose for
 * themselves.
 */

const ICONS: Readonly<Record<string, ReactNode>> = {
  overview: <Home className="size-full" />,
  review: <ClipboardCheck className="size-full" />,
  cycle: <RefreshCw className="size-full" />,
  goals: <Target className="size-full" />,
  "check-in": <CheckCircle2 className="size-full" />,
  "account-security": <Shield className="size-full" />,
};

function iconFor(id: string): ReactNode {
  return ICONS[id] ?? <Inbox className="size-full" />;
}

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

  const path = (await headers()).get("x-openokr-path") ?? "/";
  const active = activeItemId(path, [
    ...sidebarItems,
    { id: "admin", href: "/admin" },
  ]);

  const groups: SidebarGroup[] = [
    {
      id: "primary",
      items: sidebarItems.map((item) => ({
        id: item.id,
        label: item.label,
        href: item.href,
        icon: iconFor(item.id),
        active: item.id === active,
        ...(item.id === "review" && reviewBadge !== null
          ? { badge: reviewBadge }
          : {}),
      })),
    },
  ];
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
      <AppShell
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
            avatarMenu={
              <AvatarMenu
                name={workspace.name}
                securityHref="/account/security"
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
        {children}
      </AppShell>
      <ShortcutOverlay />
      <StaleDeploymentWatcher buildId={loadEnv().APP_BUILD_ID} />
    </KeyboardRegistryProvider>
  );
}
