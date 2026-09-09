import type { CheckInFrequency, CoachStrictness } from "@openokr/method";
import { CHECK_IN_FREQUENCIES, COACH_STRICTNESS } from "@openokr/method";
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

/** Who the setting belongs to: the whole workspace, or one person. */
export type SettingScope = "workspace" | "member" | "space";

/**
 * Which table holds it (P6-G08).
 *
 * Scope used to imply the home, because there were two scopes and two tables.
 * §4.14's member half is larger than that: the notification preferences have
 * lived in `notification_settings` since P2-T06, created lazily on first read,
 * and a member's own row is not the same storage as a member column. So the
 * home is declared rather than inferred, and `resolveMemberSettings` filters
 * on it: that function's answer is written into `workspace_members` at
 * provisioning, and a notification key in it would be written to a column that
 * does not exist.
 */
type SettingHome =
  | "workspaces.settings"
  | "workspace_members"
  | "notification_settings"
  | "spaces.settings";

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
  /** The table the value lives in. */
  readonly home: SettingHome;
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
 * The batch window and the daily summary hour, from §11's worked example.
 *
 * Moved here from `notifications/settings.ts` at P6-G08, so every §4.14
 * default is defined in the one file the registry is. They were declared
 * beside the table helper that reads them, which was the right place while the
 * registry did not know about them and the wrong place the moment it did:
 * "never hardcode a value that belongs in the §4.14 map" applies to a
 * constant in another module as much as to a literal.
 */
export const DEFAULT_BATCH_WINDOW_MINUTES = 30;
export const DEFAULT_DAILY_SUMMARY_TIME = "08:00";

/**
 * §4.14's space scope (P6-G18b).
 *
 * **Team voting is on, and a space turns it off.** §8.1 gives the retro a
 * voting stage with dots per member, so it is part of the practice as written
 * and a fresh space does it. "Opt-in" in §4.14's row is about the space's
 * choice to keep it, not about a product that ships the retro with a step
 * missing.
 *
 * **The other two are null, and null means "the workspace's".** A space that
 * has decided nothing is not a space that has decided to be lenient. Storing
 * the workspace's current value instead would freeze it: changing the
 * workspace's strictness would then leave every space holding the old one,
 * which is the same trap the §11 override map avoids by storing deviations
 * rather than resolved values.
 */
const DEFAULT_SPACE_TEAM_VOTING = true;

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

const exportInlineRowLimitSchema = z.number().int().positive();

const importRowLimitSchema = z.number().int().positive();

/**
 * How many rows one wizard run may carry (P6-T01b-b).
 *
 * Exported because the two table actions need it for workspaces provisioned
 * before the setting existed, whose settings map has no key to read. One
 * constant, so the default a fresh workspace stores and the default an old one
 * falls back to cannot drift apart.
 */
export const DEFAULT_IMPORT_ROW_LIMIT = 1000;

/** Dollars, not cents, and zero is allowed: it means "may not spend". */
const agentRunCostCapSchema = z.number().nonnegative();

/**
 * The cap a workspace inherits, in US dollars per agent run (P4-T05a).
 *
 * Exported because the run itself needs it for workspaces provisioned before
 * the setting existed, whose settings map has no key to read. One constant, so
 * the default a fresh workspace stores and the default an old one falls back to
 * cannot drift apart.
 */
export const DEFAULT_AGENT_RUN_COST_CAP_USD = 2;

/** How long a half-finished chat conversation waits to be resumed (P5-T06b). */
export const DEFAULT_CHAT_CONVERSATION_MINUTES = 30;

/**
 * How long a prepared upload waits to be claimed before it is an orphan
 * (P6-G01c).
 *
 * Twenty-four hours. A prepare that is never claimed is a browser that closed,
 * an upload that failed, or a tab somebody abandoned, and none of those come
 * back a day later. Short enough that a bucket does not fill with bytes nobody
 * asked for, long enough that a slow upload over a bad connection is never
 * reaped out from under itself. TECHNICAL-PLAN asks for the reap and names no
 * figure; P6-G01c picked this one.
 *
 * Exported for the same reason the two above it are: a workspace provisioned
 * before this setting existed has no key to read, and one constant keeps the
 * stored default and the fallback from drifting apart.
 */
export const DEFAULT_ORPHAN_BLOB_MINUTES = 24 * 60;

/** Minutes. An hour is the floor; a month is well past any use for one. */
const orphanBlobMinutesSchema = z
  .number()
  .int()
  .min(60)
  .max(60 * 24 * 30);

/**
 * The channels a member can be reached on.
 *
 * Exported since P6-G21: a nudge rule's channel override picks from the same
 * set, and a second copy of this list would drift the first time a provider
 * is added.
 */
export const primaryChannelSchema = z.enum([
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

/**
 * Per-reason routing: a channel per reason, and the member's primary channel
 * for every reason absent (P6-G08).
 *
 * A partial record rather than one entry per reason. §4.14's default is "the
 * primary channel for everything", and a map pre-filled with six copies of the
 * primary channel would freeze it: changing the primary would then leave six
 * stale overrides behind it.
 */
const routingSchema = z.partialRecord(z.string(), primaryChannelSchema);

/** Minutes. One is the floor, a day is the ceiling. */
const batchWindowSchema = z.number().int().min(1).max(1440);

/** "HH:MM" on a 24-hour clock. The hour is what the hourly sweep reads. */
const summaryTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = [
  {
    key: "timezone",
    scope: "workspace",
    home: "workspaces.settings",
    why: "The registering member's browser timezone, falling back to UTC. Every rhythm date is read in it, so it cannot be left unset.",
    resolve: resolveTimezone,
    schema: timezoneSchema,
    card: "general",
  },
  {
    key: "language",
    scope: "workspace",
    home: "workspaces.settings",
    why: "Inherited from the instance default, which is English until somebody changes it.",
    resolve: (context) => context.language ?? INSTANCE_DEFAULT_LANGUAGE,
    schema: languageSchema,
    card: "general",
  },
  {
    key: "branding",
    scope: "workspace",
    home: "workspaces.settings",
    why: "The product's own palette until a brand colour is chosen. Empty means the default theme, not an unanswered question.",
    resolve: () => ({}),
    schema: brandingSchema,
    card: "branding",
  },
  {
    key: "trustedEmailDomains",
    scope: "workspace",
    home: "workspaces.settings",
    why: "None. Joining is by invitation, so an open domain is never the default.",
    resolve: () => [],
    schema: trustedEmailDomainsSchema,
    card: "general",
  },
  {
    key: "storageQuotaBytes",
    scope: "workspace",
    home: "workspaces.settings",
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
    key: "exportInlineRowLimit",
    scope: "workspace",
    home: "workspaces.settings",
    why:
      "5000 rows: enough that every ordinary export is a file somebody gets " +
      "in the moment they ask, small enough that a request never spends a " +
      "minute building one. Above it the relay builds the file and the " +
      "person collects it from their own list. TECHNICAL-PLAN §4.9 says to " +
      "run large sets asynchronously and names no figure; P5-T15 picked " +
      "this one. No S-36 card names it yet, so it has none here.",
    resolve: () => 5000,
    schema: exportInlineRowLimitSchema,
  },
  {
    key: "importRowLimit",
    scope: "workspace",
    home: "workspaces.settings",
    why:
      "1000 rows: a run the browser waits for, and each row is its own " +
      "transaction through the Operation pipeline, so a thousand is already " +
      "a thousand transactions plus their reference lookups. A bigger file " +
      "is what `pnpm import:csv` is for, and it reads a path rather than " +
      "holding a table in a request, so the bound is on the wizard's two " +
      "actions and not on the command. IMPLEMENTATION-PLAN asks for a bound " +
      "and names no figure; P6-T01b-b picked this one. A file above it is " +
      "refused with the number rather than truncated, because half an " +
      "import nobody asked for is worse than none. No S-36 card names it " +
      "yet, so it has none here.",
    resolve: () => DEFAULT_IMPORT_ROW_LIMIT,
    schema: importRowLimitSchema,
  },
  {
    key: "orphanBlobMinutes",
    scope: "workspace",
    home: "workspaces.settings",
    why:
      "A day. `findOrphanedBlobs` and `discardOrphanedBlob` were written at " +
      "P2-T05 and nothing called them, so every prepare that was never " +
      "claimed stayed in the table and its bytes stayed in the bucket for " +
      "good. The reap is a scheduled run now (P6-G01c) and this is how old a " +
      "pending row has to be before it takes it. No S-36 card names it yet, " +
      "so it has none here.",
    resolve: () => DEFAULT_ORPHAN_BLOB_MINUTES,
    schema: orphanBlobMinutesSchema,
  },
  {
    key: "teamVoting",
    scope: "space",
    home: "spaces.settings",
    why:
      "On. §8.1's retro has a voting stage, so a fresh space practises the " +
      "method as written and a space that does not want it turns it off. The " +
      "action refuses a vote in a space that has, rather than the screen " +
      "merely hiding the control.",
    resolve: () => DEFAULT_SPACE_TEAM_VOTING,
    schema: z.boolean(),
  },
  {
    key: "coachStrictness",
    scope: "space",
    home: "spaces.settings",
    why:
      "Null, meaning the workspace's own. A space that has decided nothing " +
      "has not decided to be lenient. Storing the workspace's current value " +
      "would freeze it: changing the workspace's strictness would leave every " +
      "space holding the old one, which is the trap the §11 override map " +
      "avoids by storing deviations rather than resolved values.",
    resolve: () => null,
    schema: z.enum(COACH_STRICTNESS).nullable(),
  },
  {
    key: "defaultCheckInFrequency",
    scope: "space",
    home: "spaces.settings",
    why:
      "Null, meaning the workspace's own §11 cadence. §4.14 calls this row " +
      '"space defaults" without naming which; the check-in frequency is the ' +
      "one default a space plausibly differs on, because a team shipping " +
      "daily and a team shipping quarterly are the same workspace. Null " +
      "inherits for the same reason the strictness override does.",
    resolve: () => null,
    schema: z.enum(CHECK_IN_FREQUENCIES).nullable(),
  },
  {
    key: "language",
    scope: "member",
    home: "workspace_members",
    why:
      "Null, which reads as follow the workspace. A product that picked a " +
      "language for somebody would be overriding the answer their " +
      "organisation already gave. The workspace half of this setting has " +
      "existed since P2-T10 and was read by no renderer until P6-G22a.",
    resolve: () => null,
    schema: z.enum(["en", "ms"]).nullable(),
  },
  {
    key: "theme",
    scope: "member",
    home: "workspace_members",
    why:
      "Null, which the theme provider reads as follow the system. A product " +
      "that picked light or dark for somebody would be overriding a choice " +
      "they already made in their operating system. Stored per member from " +
      "P6-G23 rather than only in the browser, so it follows them.",
    resolve: () => null,
    schema: z.enum(["light", "dark", "system"]).nullable(),
  },
  {
    key: "density",
    scope: "member",
    home: "workspace_members",
    why:
      "Null, which the shell reads as comfortable. UIUX-PLAN §9 asks every " +
      "interface task to verify both densities, and until P6-G23 neither was " +
      "reachable from the product.",
    resolve: () => null,
    schema: z.enum(["comfortable", "compact"]).nullable(),
  },
  {
    key: "primaryChannel",
    scope: "member",
    home: "workspace_members",
    why: "Email, beside the always-on in-app inbox, until a chat identity is linked.",
    resolve: () => "email",
    schema: primaryChannelSchema,
  },
  {
    key: "quietHours",
    scope: "member",
    home: "workspace_members",
    why: "19:00 to 08:00 in the member's own timezone, so the product cannot wake somebody up on its first day.",
    resolve: () => DEFAULT_QUIET_HOURS,
    schema: quietHoursSchema,
  },
  {
    key: "routing",
    scope: "member",
    home: "notification_settings",
    why:
      "Empty, which means every reason goes to the member's primary channel. " +
      "A map pre-filled with the primary channel would freeze it: changing " +
      "the primary would leave a stale override behind for every reason.",
    resolve: () => ({}),
    schema: routingSchema,
  },
  {
    key: "mentionImmediate",
    scope: "member",
    home: "notification_settings",
    why:
      "On. §11's worked example makes a mention the one reason that does not " +
      "wait for a window: somebody wrote your name and expects you to read " +
      "it, and a mention held for half an hour is a conversation missed.",
    resolve: () => true,
    schema: z.boolean(),
  },
  {
    key: "batchWindowMinutes",
    scope: "member",
    home: "notification_settings",
    why:
      "Thirty minutes, from §11's worked example. Short enough that a busy " +
      "morning still reaches somebody the same morning, long enough that a " +
      "fan-out across a goal's watchers arrives as one mail.",
    resolve: () => DEFAULT_BATCH_WINDOW_MINUTES,
    schema: batchWindowSchema,
  },
  {
    key: "dailySummary",
    scope: "member",
    home: "notification_settings",
    why:
      "On. §4.14 makes this the default and it outranks AI-NATIVE-PLAN §6.4's " +
      '"everyone opted in", which reads as opt-out in practice. A member ' +
      "who never opens their settings still gets the summary.",
    resolve: () => true,
    schema: z.boolean(),
  },
  {
    key: "dailySummaryTime",
    scope: "member",
    home: "notification_settings",
    why:
      "08:00 in the member's own timezone. The hour is what the run checks: " +
      "the sweep is hourly, so a summary set to 08:30 arrives in the 08:00 " +
      "hour, and storing a minute the product cannot honour would be a " +
      "setting that quietly does nothing.",
    resolve: () => DEFAULT_DAILY_SUMMARY_TIME,
    schema: summaryTimeSchema,
  },
  {
    key: "agentRunCostCapUsd",
    scope: "workspace",
    home: "workspaces.settings",
    why:
      "2.00 US dollars per agent run. The deterministic path costs nothing, " +
      "so this only ever bounds AI spend, and one run drafting a handful of " +
      "check-ins does not approach it. TECHNICAL-PLAN names no figure; " +
      "P4-T05a picked this one. Zero is a valid value and means the agent " +
      "may not spend at all, which halts its run rather than failing it. No " +
      "S-36 card names it yet, so it has none here.",
    resolve: () => DEFAULT_AGENT_RUN_COST_CAP_USD,
    schema: agentRunCostCapSchema,
  },
  {
    key: "chatConversationMinutes",
    scope: "workspace",
    home: "workspaces.settings",
    why:
      "Thirty minutes. Long enough that somebody can answer three questions " +
      "between meetings, short enough that a half-finished check-in does not " +
      "wait overnight to be resumed by a message about something else. " +
      "Design §8.1 named the figure and put it in METHOD.md's §11 registry; " +
      "it is here instead, because §11 is the OKR practice canon and how long " +
      "a chat window stays open is an interaction timeout rather than a " +
      "practice rule. Corrected in the design document at P5-T06b.",
    resolve: () => DEFAULT_CHAT_CONVERSATION_MINUTES,
    schema: z
      .number()
      .int()
      .min(1)
      .max(24 * 60),
  },
  {
    key: "onboardingDone",
    scope: "workspace",
    home: "workspaces.settings",
    why:
      "True, which means nothing is pending. **The default is deliberately " +
      "the finished state** (P6-G26): a workspace nobody explicitly marked " +
      "has nothing to finish, which is the right answer for every workspace " +
      "that existed before this key did. Provisioning writes false, because " +
      "that is the one place a brand-new workspace is born.",
    resolve: () => true,
    schema: z.boolean(),
  },
  {
    key: "demoEnabled",
    scope: "workspace",
    home: "workspaces.settings",
    why: "Off. Demo data is opted into, never assumed. The wizard offers the checkbox (P3-T17), and the seed command reads it.",
    resolve: () => false,
    schema: z.boolean(),
    card: "general",
  },
];

/** Every workspace-scoped setting on one S-36 admin card, in registry order. */
export function settingsByCard(card: string): readonly SettingDefinition[] {
  return SETTINGS_REGISTRY.filter((setting) => setting.card === card);
}

/**
 * The one **workspace** setting at this key, or undefined (P6-G22a).
 *
 * **Scoped, because a key is no longer unique on its own.** §4.14 has both a
 * workspace language and a member language, and P6-G22a added the second, so
 * `language` names two settings that are stored in two places. A lookup by key
 * alone would return whichever the array happened to hold first, and its one
 * caller is the reset path, which refuses anything but a workspace setting a
 * line later. Filtering here makes that correct by construction rather than by
 * the order somebody wrote the entries in.
 *
 * A member setting is never looked up this way: both resolvers filter by
 * `home` and hand back the whole set.
 */
export function findWorkspaceSetting(
  key: string,
): SettingDefinition | undefined {
  return SETTINGS_REGISTRY.find(
    (setting) => setting.key === key && setting.scope === "workspace",
  );
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

/**
 * Every setting stored as a member column, resolved. Written at provisioning.
 *
 * Filtered on the home rather than the scope since P6-G08: the notification
 * preferences are member-scoped too and live in their own table, created
 * lazily, so including them here would write keys to columns that do not exist.
 */
export function resolveMemberSettings(context: ProvisioningContext): {
  readonly primaryChannel: string;
  readonly quietHours: { readonly start: string; readonly end: string };
} {
  return Object.fromEntries(
    SETTINGS_REGISTRY.filter(
      (setting) => setting.home === "workspace_members",
    ).map((setting) => [setting.key, setting.resolve(context)]),
  ) as ReturnType<typeof resolveMemberSettings>;
}

/**
 * Every space-scoped setting, resolved (P6-G18b).
 *
 * Written into `spaces.settings` when a space is created, and used as the
 * fallback for a space created before this scope existed, whose settings map
 * has no key to read. One function, so the default a new space stores and the
 * default an old one falls back to cannot drift apart.
 *
 * Takes no provisioning context: none of the three depends on the browser or
 * the instance. The parameter is there so the shape matches its two siblings
 * and a setting that later does need one can have it without changing callers.
 */
export function resolveSpaceSettings(): {
  readonly teamVoting: boolean;
  readonly coachStrictness: CoachStrictness | null;
  readonly defaultCheckInFrequency: CheckInFrequency | null;
} {
  return Object.fromEntries(
    SETTINGS_REGISTRY.filter(
      (setting) => setting.home === "spaces.settings",
    ).map((setting) => [setting.key, setting.resolve({})]),
  ) as ReturnType<typeof resolveSpaceSettings>;
}

/**
 * One space's settings, with anything it has not chosen filled from the
 * registry (P6-G18b).
 *
 * **A stored value wins only when the key is present.** A space created before
 * this scope existed holds `{}`, and every key in it resolves to the registry
 * default, which is what "a space that has configured nothing resolves each to
 * its documented default" means.
 */
export function resolveSpaceSettingsFrom(
  stored: Record<string, unknown> | null | undefined,
): ReturnType<typeof resolveSpaceSettings> {
  const defaults = resolveSpaceSettings() as Record<string, unknown>;
  const resolved: Record<string, unknown> = { ...defaults };
  for (const setting of SETTINGS_REGISTRY) {
    if (setting.home !== "spaces.settings") {
      continue;
    }
    if (stored && Object.hasOwn(stored, setting.key)) {
      const parsed = setting.schema.safeParse(stored[setting.key]);
      // A stored value that no longer parses means the schema tightened after
      // it was written. The default always parses, and a setting that cannot
      // be read has no business deciding what a team sees.
      if (parsed.success) {
        resolved[setting.key] = parsed.data;
      }
    }
  }
  return resolved as ReturnType<typeof resolveSpaceSettings>;
}

/**
 * Every notification preference, resolved (P6-G08).
 *
 * The registry's answer for a member who has never opened the screen, which
 * must agree with what `notification_settings`' own column defaults produce.
 * A test asserts they do, enumerated from here rather than from a list: two
 * homes for one default is one default that will drift.
 */
export function resolveMemberNotificationSettings(
  context: ProvisioningContext,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    SETTINGS_REGISTRY.filter(
      (setting) => setting.home === "notification_settings",
    ).map((setting) => [setting.key, setting.resolve(context)]),
  );
}
