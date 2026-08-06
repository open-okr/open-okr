/**
 * The instance settings map (TECHNICAL-PLAN §4.2, §4.14).
 *
 * Every instance setting is declared here with a working default, because of
 * the hard rule: nothing must be configured before the product works. A fresh
 * instance with an empty `system_settings` table and no environment beyond
 * `DATABASE_URL` resolves every one of these, and the wizard confirms them
 * rather than demanding them.
 *
 * `environment` names the variable that bootstraps a setting. It is a starting
 * value, not an override: a value written through the wizard or administration
 * wins, so changing a setting in the product survives the next restart.
 */

type InstanceSettingKind = "string" | "number" | "boolean";

export interface InstanceSettingDefinition {
  readonly key: string;
  readonly kind: InstanceSettingKind;
  /** Resolved when nothing is stored and no environment value is present. */
  readonly fallback: unknown;
  /** The bootstrap environment variable, when the setting has one. */
  readonly environment?: string;
  /** Held in the sealed columns rather than `value`. Never returned to a page. */
  readonly secret?: boolean;
  readonly summary: string;
}

/** Marks the wizard finished. Its presence is what "configured" means. */
export const SETUP_COMPLETED_AT = "setup.completed_at";

export const INSTANCE_SETTINGS: readonly InstanceSettingDefinition[] = [
  {
    key: SETUP_COMPLETED_AT,
    kind: "string",
    fallback: "",
    summary:
      "When the first-run wizard finished. Empty means the instance is unconfigured.",
  },
  {
    key: "instance.name",
    kind: "string",
    fallback: "OpenOKR",
    environment: "OPENOKR_INSTANCE_NAME",
    summary: "What this deployment calls itself in mail and the page title.",
  },
  {
    key: "instance.language",
    kind: "string",
    fallback: "en",
    environment: "OPENOKR_DEFAULT_LANGUAGE",
    summary: "The default language for new workspaces (§4.2: English).",
  },
  {
    key: "registration.policy",
    kind: "string",
    fallback: "auto",
    environment: "OPENOKR_REGISTRATION",
    summary:
      "'auto' is open until the instance is claimed and closed afterwards. 'open' and 'invite_only' fix it either way.",
  },
  {
    key: "instance.telemetry",
    kind: "boolean",
    fallback: false,
    environment: "OPENOKR_TELEMETRY",
    summary: "Anonymous usage reporting. Off unless deliberately turned on.",
  },
  {
    key: "mail.transport",
    kind: "string",
    fallback: "console",
    environment: "OPENOKR_MAIL_TRANSPORT",
    summary:
      "'console' writes mail to the log, 'smtp' sends it. Console is the default, so a fresh instance needs no mail server.",
  },
  {
    key: "mail.host",
    kind: "string",
    fallback: "",
    environment: "OPENOKR_MAIL_HOST",
    summary: "SMTP host.",
  },
  {
    key: "mail.port",
    kind: "number",
    fallback: 587,
    environment: "OPENOKR_MAIL_PORT",
    summary: "SMTP port. 587 for STARTTLS, 465 for implicit TLS.",
  },
  {
    key: "mail.secure",
    kind: "boolean",
    fallback: false,
    environment: "OPENOKR_MAIL_SECURE",
    summary:
      "Implicit TLS from the first byte. False means STARTTLS, which is what port 587 expects.",
  },
  {
    key: "mail.user",
    kind: "string",
    fallback: "",
    environment: "OPENOKR_MAIL_USER",
    summary: "SMTP username. Empty means an unauthenticated relay.",
  },
  {
    key: "mail.password",
    kind: "string",
    fallback: "",
    environment: "OPENOKR_MAIL_PASSWORD",
    secret: true,
    summary: "SMTP password. Envelope-encrypted, never returned to a page.",
  },
  {
    key: "mail.from",
    kind: "string",
    fallback: "openokr@localhost",
    environment: "OPENOKR_MAIL_FROM",
    summary: "The From address on everything the instance sends.",
  },
];

const BY_KEY = new Map(
  INSTANCE_SETTINGS.map((setting) => [setting.key, setting]),
);

export function getInstanceSetting(
  key: string,
): InstanceSettingDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * Reads a setting's bootstrap value out of an environment record.
 *
 * Returns undefined for a variable that is absent or blank, because container
 * runtimes deliver "unset" as an empty string and an empty SMTP host is not a
 * deliberate choice to have none.
 */
export function environmentValue(
  definition: InstanceSettingDefinition,
  environment: Record<string, string | undefined>,
): unknown | undefined {
  if (!definition.environment) {
    return undefined;
  }
  const raw = environment[definition.environment];
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }

  switch (definition.kind) {
    case "number": {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    case "boolean":
      // Accepts what an operator would actually write in a compose file.
      return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
    default:
      return raw;
  }
}
