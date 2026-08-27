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
    name: "review",
    navigation: [
      {
        id: "review",
        label: "Review",
        href: "/review",
        section: "sidebar",
        // Every member reaches it, and every member sees a different page: the
        // inbox only ever lists what the reader themselves owes, so there is
        // nothing here to withhold from anybody (P3-T08).
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "cycle",
    navigation: [
      {
        id: "cycle",
        label: "Cycle",
        href: "/cycle",
        section: "sidebar",
        // Every member can watch the cycle being planned. The writes on the
        // screen each ask for edit access of their own, so a reader sees the
        // workflow without being handed a control they cannot use (P3-T03).
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "goals",
    navigation: [
      {
        id: "goals",
        label: "Goals",
        href: "/goals",
        section: "sidebar",
        // Every member can read the set. An OKR set nobody can read is not one,
        // which is the same reason a goal's context binds `workspace_standard`
        // at view (P3-T04). The writes on each row ask for their own access.
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "kpis",
    navigation: [
      {
        id: "kpis",
        label: "KPIs",
        href: "/kpis",
        section: "sidebar",
        // Every member reads the grid. A measure nobody can see is not a
        // shared measure, which is the same reason a company objective binds
        // workspace_standard at view (P3-T12).
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "scorecard",
    navigation: [
      {
        id: "scorecard",
        label: "Scorecard",
        href: "/scorecard",
        section: "sidebar",
        // The result of every closed cycle, which is a shared record rather
        // than a private one: a team that cannot see how the last quarter went
        // cannot learn from it (P3-T15).
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "check-in",
    navigation: [
      {
        id: "check-in",
        label: "Check in",
        href: "/check-in",
        section: "sidebar",
        // Every member can reach it. The walker only ever lists the goals they
        // champion, so a member with nothing due sees an empty list rather than
        // somebody else's obligations (P3-T07).
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "sessions",
    navigation: [
      {
        id: "sessions",
        label: "Sessions",
        href: "/sessions",
        section: "sidebar",
        // Every member reaches it, and every member sees a different list: it
        // is scoped by the same access filter the space list uses, so a
        // session in a space somebody cannot read is not in it. S-22 to S-25
        // were built in Phase 4 with nothing linking to them, which made every
        // session feature reachable only by typing a URL (P5-T01c).
        minLevel: ACCESS_LEVELS.view,
      },
    ],
  },
  {
    name: "spaces",
    navigation: [
      {
        id: "spaces",
        label: "Spaces",
        href: "/spaces",
        section: "sidebar",
        // Every human member can see that spaces exist and join one, which is
        // what makes a team home a home rather than a locked room (P3-T01).
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
      {
        id: "admin-rhythm",
        label: "Rhythm and thresholds",
        href: "/admin/rhythm",
        section: "admin",
        // §4.14 governs this card with the `manage_coaching` permission. Until
        // named permissions land, workspace admin is the closest honest level.
        minLevel: ACCESS_LEVELS.full,
      },
      {
        id: "admin-nudges",
        label: "Nudge volume",
        href: "/admin/nudges",
        section: "admin",
        // The same permission and the same reason: this names who is being
        // nudged the most, which is not a fact everybody in a workspace needs.
        minLevel: ACCESS_LEVELS.full,
      },
      {
        id: "admin-agents",
        label: "Agents and runs",
        href: "/admin/agents",
        section: "admin",
        // An agent's persona, its scope and what it did last hour. Reading a
        // run log is reading what the product said to people, which is the
        // same fact the nudge card guards.
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
