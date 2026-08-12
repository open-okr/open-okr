/**
 * The module registry (TECHNICAL-PLAN §4.14, UIUX-PLAN.md §4 S-36, P2-T08).
 *
 * One flat list of navigation items, each declaring the access level a
 * member needs to see it. It grows the way `SETTINGS_REGISTRY` grows: a
 * module contributes its own entries as it lands, rather than one file
 * enumerating every screen the whole plan describes today.
 *
 * Deliberately DB-free and synchronous, like `SETTINGS_REGISTRY`: the level
 * a caller compares against is resolved elsewhere, by `resolveMemberAccessLevel`
 * against the workspace's own context, because a navigation item's access
 * requirement and a member's resolved access level are two different
 * questions and only the second one needs a database.
 *
 * "Hidden" and "denied" both come from `isRouteAllowed`: whoever renders the
 * sidebar filters with it before drawing a link, and whoever handles the
 * request checks it again before doing anything, because a hidden link is
 * cosmetic and the second check is the one that matters.
 */
import { ACCESS_LEVELS, type AccessLevel } from "../access/levels.ts";

export type NavigationSection = "sidebar" | "admin";

export interface NavigationItem {
  /** Unique across the whole registry, not just its own section. */
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly section: NavigationSection;
  /** The member's resolved level on the workspace must be at least this. */
  readonly minLevel: AccessLevel;
}

export interface ModuleDefinition {
  readonly name: string;
  readonly navigation: readonly NavigationItem[];
}

export const MODULE_REGISTRY: readonly ModuleDefinition[] = [
  {
    name: "overview",
    navigation: [
      {
        id: "overview",
        label: "Overview",
        href: "/",
        section: "sidebar",
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "account",
    navigation: [
      {
        id: "account-security",
        label: "Security",
        href: "/account/security",
        section: "sidebar",
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "settings",
    navigation: [
      {
        id: "admin-general",
        label: "General",
        href: "/admin/general",
        section: "admin",
        minLevel: ACCESS_LEVELS.full,
      },
      {
        id: "admin-branding",
        label: "Branding",
        href: "/admin/branding",
        section: "admin",
        minLevel: ACCESS_LEVELS.full,
      },
    ],
  },
];

function allNavigationItems(): readonly NavigationItem[] {
  return MODULE_REGISTRY.flatMap((module) => module.navigation);
}

/** Every item in a section this level reaches, registry order preserved. */
export function navigationFor(
  section: NavigationSection,
  level: number,
): readonly NavigationItem[] {
  return allNavigationItems().filter(
    (item) => item.section === section && level >= item.minLevel,
  );
}

/** The registered item at this href, or undefined for a route the registry does not govern. */
export function findNavigationItem(href: string): NavigationItem | undefined {
  return allNavigationItems().find((item) => item.href === href);
}

/**
 * Whether this level may reach this route.
 *
 * A route the registry has no entry for is not denied by it: the registry
 * governs what it knows about, and an ungoverned route's own handler is
 * responsible for whatever check it needs, the same way a resource with no
 * `SUBJECT_RESOLVERS` entry is `resolveSubjectContext`'s problem, not this
 * one's.
 */
export function isRouteAllowed(href: string, level: number): boolean {
  const item = findNavigationItem(href);
  return item ? level >= item.minLevel : true;
}
