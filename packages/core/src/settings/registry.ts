import { z } from "zod";

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
 * per-member notification routing with theirs.
 *
 * `schema` validates a value an admin screen is about to write, which is a
 * stricter question than "does this resolve to something": a nonsense
 * timezone falls back silently at registration (nobody can be blocked by it),
 * but an admin who types one into a settings card gets told, not humoured.
 * `card` names the S-36 admin card a workspace-scoped setting belongs to, so
 * the reset action in `actions/settings.ts` can restore a whole card at once.
 * A setting with no card yet (nothing in UIUX-PLAN.md §4 names one for it)
 * is reset only one key at a time.
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
  /** Validates a value an admin screen wants to write. */
  readonly schema: z.ZodType;
  /**
   * The S-36 admin card this setting is edited from, when one exists yet.
   * Undefined for a setting with no admin surface of its own so far.
   */
  readonly card?: string;
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

/** A DNS-shaped domain, lower-cased: `mail.example.co`, not an email address. */
const DOMAIN_PATTERN =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isKnownTimezone, { message: "not a timezone the runtime knows" });

export const languageSchema = z.string().trim().min(2).max(35);

export const brandingSchema = z
  .object({
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "not a hex colour")
      .optional(),
  })
  .catchall(z.unknown());

export const trustedEmailDomainsSchema = z.array(
  z.string().trim().toLowerCase().regex(DOMAIN_PATTERN, "not a domain"),
);

const storageQuotaBytesSchema = z.number().int().positive();

const primaryChannelSchema = z.enum([
  "app",
  "email",
  "slack",
  "teams",
  "whatsapp",
  "telegram",
]);

const quietHoursSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  {
    key: "timezone",
    scope: "workspace",
    why: "The registering member's browser timezone, falling back to UTC. Every rhythm date is read in it, so it cannot be left unset.",
    resolve: resolveTimezone,
    schema: timezoneSchema,
    card: "general",
  },
  {
    key: "language",
    scope: "workspace",
    why: "Inherited from the instance default, which is English until somebody changes it.",
    resolve: (context) => context.language ?? INSTANCE_DEFAULT_LANGUAGE,
    schema: languageSchema,
    card: "general",
  },
  {
    key: "branding",
    scope: "workspace",
    why: "The product's own palette until a brand colour is chosen. Empty means the default theme, not an unanswered question.",
    resolve: () => ({}),
    schema: brandingSchema,
    card: "branding",
  },
  {
    key: "trustedEmailDomains",
    scope: "workspace",
    why: "None. Joining is by invitation, so an open domain is never the default.",
    resolve: () => [],
    schema: trustedEmailDomainsSchema,
    card: "general",
  },
  {
    key: "storageQuotaBytes",
    scope: "workspace",
    why:
      "5 GiB: enough for a small team's files on the local disk driver " +
      "without configuration, small enough that a runaway upload loop is " +
      "noticed. TECHNICAL-PLAN names no figure; P2-T05 picked this one. " +
      "No S-36 card names it yet, so it has none here; a storage admin " +
      "card is a later task's follow-up, not this one's to invent.",
    resolve: () => 5 * 1024 * 1024 * 1024,
    schema: storageQuotaBytesSchema,
  },
  {
    key: "primaryChannel",
    scope: "member",
    why: "Email, beside the always-on in-app inbox, until a chat identity is linked.",
    resolve: () => "email",
    schema: primaryChannelSchema,
  },
  {
    key: "quietHours",
    scope: "member",
    why: "19:00 to 08:00 in the member's own timezone, so the product cannot wake somebody up on its first day.",
    resolve: () => DEFAULT_QUIET_HOURS,
    schema: quietHoursSchema,
  },
];

/** Every workspace-scoped setting on one S-36 admin card, in registry order. */
export function settingsByCard(card: string): readonly SettingDefinition[] {
  return SETTINGS_REGISTRY.filter((setting) => setting.card === card);
}

/** The one setting at this key, or undefined for a key outside the map. */
export function findSetting(key: string): SettingDefinition | undefined {
  return SETTINGS_REGISTRY.find((setting) => setting.key === key);
}

/** Every workspace-scoped setting, resolved. Stored in `workspaces.settings`. */
export function resolveWorkspaceSettings(context: ProvisioningContext): {
  readonly timezone: string;
  readonly language: string;
  readonly branding: Record<string, unknown>;
  readonly trustedEmailDomains: readonly string[];
  readonly storageQuotaBytes: number;
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
