/**
 * The settings registry (TECHNICAL-PLAN §4.14).
 *
 * Two rules from the plan are made mechanical here.
 *
 * "A setting that is not in this map does not exist." Every setting the
 * product has is declared once, in this list, with the place it is stored and
 * the default it resolves to.
 *
 * "Every setting has a working default, and no setting must be answered before
 * the product is usable." Registering provisions a complete workspace. Nothing
 * asks the first member to choose anything, and no screen may block until
 * something is chosen. The settings test walks this registry rather than a
 * fixed list, so a module that adds a setting without a default fails the
 * build instead of shipping a workspace with a hole in it.
 *
 * Only settings whose storage home exists today are listed. The rest arrive
 * with their modules: rhythm thresholds and terminology with the method
 * package, coaching and nudges with the nudge engine, channels, AI, spaces and
 * per-member notification routing with theirs. Instance settings wait for
 * `system_settings` and the first-run wizard (P1-T09).
 */

/** Where a setting is stored. Each scope has exactly one storage home. */
export type SettingScope = "workspace" | "member";

/** What provisioning knows about the person and the request. */
export interface ProvisioningContext {
  /** The registering browser's timezone. Untrusted: validated before use. */
  readonly timezone?: string;
  /** The instance default language. */
  readonly language?: string;
}

export interface SettingDefinition {
  /** The key inside its storage home. Unique across the registry. */
  readonly key: string;
  readonly scope: SettingScope;
  /** One line on why the default is the right one to ship. */
  readonly why: string;
  resolve(context: ProvisioningContext): unknown;
}

/**
 * The instance default language (§4.14). It lives here as a constant until
 * `system_settings` exists; a workspace inherits it at provisioning.
 */
export const INSTANCE_DEFAULT_LANGUAGE = "en";

/** Quiet hours, in the member's own timezone. */
export const DEFAULT_QUIET_HOURS = { start: "19:00", end: "08:00" } as const;

/**
 * Is this a timezone the runtime actually knows?
 *
 * The value arrives from the browser, so it is untrusted input reaching a
 * stored field. Asking `Intl` is the only honest check: a hand-written list
 * would rot, and a regular expression would accept plausible nonsense.
 */
export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const resolveTimezone = (context: ProvisioningContext): string => {
  const candidate = context.timezone?.trim();
  return candidate && isKnownTimezone(candidate) ? candidate : "UTC";
};

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  {
    key: "timezone",
    scope: "workspace",
    why: "The registering member's browser timezone, falling back to UTC. Every rhythm date is read in it, so it cannot be left unset.",
    resolve: resolveTimezone,
  },
  {
    key: "language",
    scope: "workspace",
    why: "Inherited from the instance default, which is English until somebody changes it.",
    resolve: (context) => context.language ?? INSTANCE_DEFAULT_LANGUAGE,
  },
  {
    key: "branding",
    scope: "workspace",
    why: "The product's own palette until a brand colour is chosen. Empty means the default theme, not an unanswered question.",
    resolve: () => ({}),
  },
  {
    key: "trustedEmailDomains",
    scope: "workspace",
    why: "None. Joining is by invitation, so an open domain is never the default.",
    resolve: () => [],
  },
  {
    key: "primaryChannel",
    scope: "member",
    why: "Email, beside the always-on in-app inbox, until a chat identity is linked.",
    resolve: () => "email",
  },
  {
    key: "quietHours",
    scope: "member",
    why: "19:00 to 08:00 in the member's own timezone, so the product cannot wake somebody up on its first day.",
    resolve: () => DEFAULT_QUIET_HOURS,
  },
];

/** Every workspace-scoped setting, resolved. Stored in `workspaces.settings`. */
export function resolveWorkspaceSettings(context: ProvisioningContext): {
  readonly timezone: string;
  readonly language: string;
  readonly branding: Record<string, unknown>;
  readonly trustedEmailDomains: readonly string[];
  readonly [key: string]: unknown;
} {
  return Object.fromEntries(
    SETTINGS_REGISTRY.filter((setting) => setting.scope === "workspace").map(
      (setting) => [setting.key, setting.resolve(context)],
    ),
  ) as ReturnType<typeof resolveWorkspaceSettings>;
}

/** Every member-scoped setting, resolved. Stored as member columns. */
export function resolveMemberSettings(context: ProvisioningContext): {
  readonly primaryChannel: string;
  readonly quietHours: { readonly start: string; readonly end: string };
} {
  return Object.fromEntries(
    SETTINGS_REGISTRY.filter((setting) => setting.scope === "member").map(
      (setting) => [setting.key, setting.resolve(context)],
    ),
  ) as ReturnType<typeof resolveMemberSettings>;
}
