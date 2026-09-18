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
  // The cloud tenancy settings (P8-T02a). All three default to the
  // self-hosted answer, so an instance that never touches them is a
  // self-hosted one. Design: docs/design/p8-t01a-tenant-lifecycle.md.
  {
    key: "cloud.enabled",
    kind: "boolean",
    fallback: false,
    environment: "OPENOKR_CLOUD",
    summary:
      "Vendor operation. Off means no tenant row is written, no operator console exists and no billing surface appears. The one setting that separates a cloud instance from a self-hosted one.",
  },
  {
    key: "cloud.region",
    kind: "string",
    fallback: "local",
    environment: "OPENOKR_CLOUD_REGION",
    summary:
      "Recorded on every tenant this deployment provisions. Recorded and never routed on: a residency claim is a contract, not a column.",
  },
  {
    key: "cloud.closureRetentionDays",
    kind: "number",
    fallback: 0,
    environment: "OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS",
    summary:
      "Days to keep a closed workspace before erasing it. Zero means never erase, because not configured must never mean delete everything (P7-T08c).",
  },
  // The two admission limits (P8-T06a). Instance scope, because they
  // describe the deployment rather than any customer, and both default to
  // unlimited so a self-hosted instance is never limited by a number nobody
  // chose. Design: docs/design/p8-t01a-tenant-limits.md §4.
  {
    key: "cloud.limits.actionsPerMinute",
    kind: "number",
    fallback: 0,
    environment: "OPENOKR_CLOUD_ACTIONS_PER_MINUTE",
    summary:
      "Actions one workspace may call a minute, across every surface. Zero means unlimited, which is every self-hosted instance. Below 60 is refused: one action a minute is an outage rather than a limit.",
  },
  {
    key: "cloud.limits.concurrentActions",
    kind: "number",
    fallback: 0,
    environment: "OPENOKR_CLOUD_CONCURRENT_ACTIONS",
    summary:
      "Actions one workspace may have running at once. Zero means unlimited. This is the one a per-minute window cannot see: sixty calls in one second pass a per-minute limit and empty the connection pool.",
  },
  {
    key: "instance.telemetry",
    kind: "boolean",
    fallback: false,
    environment: "OPENOKR_TELEMETRY",
    summary: "Anonymous usage reporting. Off unless deliberately turned on.",
  },
  // The two rows below are not that one, and reusing it for them would be the
  // direct route to failing P7-T06's "zero external calls" (P7-T06a).
  // `instance.telemetry` is data leaving the instance and is off.
  // `observability.metrics` is the instance measuring itself for its own
  // operator and sends nothing anywhere, which is why it is on.
  // `observability.otlp.endpoint` is the only setting in this product that can
  // make a measurement leave the host, and it is empty.
  {
    key: "observability.metrics",
    kind: "boolean",
    fallback: true,
    environment: "OPENOKR_OBSERVABILITY_METRICS",
    summary:
      "Serve this instance's own metrics at /api/metrics, for an instance administrator only. Local. Nothing leaves the host.",
  },
  {
    key: "observability.otlp.endpoint",
    kind: "string",
    fallback: "",
    environment: "OPENOKR_OTLP_ENDPOINT",
    summary:
      "Where to export traces and metrics. Empty means no exporter is built and nothing is ever sent. The only setting that can make measurements leave this host.",
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
  // The status endpoint thresholds (P8-T06c). The relay and scheduler
  // checks compare their lag against these to decide whether a component
  // is operational, degraded or unavailable. All four default to a value
  // that fires on a stopped process and not on a busy one.
  // Design: docs/design/p8-t06c-status-and-capacity.md §2.5 and §2.6.
  {
    key: "status.relayDegradedSeconds",
    kind: "number",
    fallback: 300,
    environment: "OPENOKR_STATUS_RELAY_DEGRADED_SECONDS",
    summary:
      "Oldest pending outbox row age, in seconds, above which /api/status reports the relay as degraded. Default 300 (5 minutes).",
  },
  {
    key: "status.relayUnavailableSeconds",
    kind: "number",
    fallback: 1800,
    environment: "OPENOKR_STATUS_RELAY_UNAVAILABLE_SECONDS",
    summary:
      "Oldest pending outbox row age, in seconds, above which /api/status reports the relay as unavailable. Default 1800 (30 minutes).",
  },
  {
    key: "status.schedulerDegradedSeconds",
    kind: "number",
    fallback: 7200,
    environment: "OPENOKR_STATUS_SCHEDULER_DEGRADED_SECONDS",
    summary:
      "Seconds without a successful scheduler run before /api/status reports it as degraded. Default 7200 (2 hours).",
  },
  {
    key: "status.schedulerUnavailableSeconds",
    kind: "number",
    fallback: 14400,
    environment: "OPENOKR_STATUS_SCHEDULER_UNAVAILABLE_SECONDS",
    summary:
      "Seconds without a successful scheduler run before /api/status reports it as unavailable. Default 14400 (4 hours).",
  },
  {
    key: "ai.deployment.provider",
    kind: "string",
    fallback: "",
    environment: "OPENOKR_AI_PROVIDER",
    summary:
      "The deployment-wide fallback AI provider (§4.14: 'the deployment-level AI key'). Empty means no deployment default; AI is off until a workspace or member supplies their own key.",
  },
  {
    key: "ai.deployment.apiKey",
    kind: "string",
    fallback: "",
    environment: "OPENOKR_AI_API_KEY",
    secret: true,
    summary:
      "The deployment-wide fallback provider's key. Envelope-encrypted, never returned to a page.",
  },
  {
    key: "ai.deployment.baseUrl",
    kind: "string",
    fallback: "",
    environment: "OPENOKR_AI_BASE_URL",
    summary:
      "Base URL for the deployment default, when the provider needs one (ollama, openai-compatible).",
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
