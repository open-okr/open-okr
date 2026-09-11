/**
 * Mail settings, resolved (P1-T09).
 *
 * The one place the seven `mail.*` registry entries become a configuration a
 * mailer can be built from. Stored value first, environment as bootstrap,
 * registry default last, and the password out of the sealed columns through
 * the key ring.
 *
 * This lives in core rather than the app so the wizard, the admin mail card
 * (S-36) and the outbox relay all resolve mail identically. It returns plain
 * data rather than a mailer, because core does not depend on
 * `packages/adapters`; the host maps this onto the adapter factory.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
  type InstanceSettingDefinition,
} from "./instance-registry.ts";
import {
  readSecret,
  readSettingRows,
  resolveSetting,
  type SettingSource,
} from "./instance-settings.ts";
import type { KeyRing } from "./key-ring.ts";

export interface ResolvedMailSettings {
  readonly transport: "console" | "smtp";
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  /** Opened from the sealed columns. Never log this object. */
  readonly password: string;
  readonly from: string;
  /** Where the transport decision came from, for the admin screen. */
  readonly source: SettingSource;
}

const definition = (key: string): InstanceSettingDefinition => {
  const found = getInstanceSetting(key);
  if (!found) {
    // Impossible unless the registry loses a mail key, and that should be a
    // loud failure in every test rather than a silent default.
    throw new Error(`The instance settings registry has no entry for ${key}.`);
  }
  return found;
};

export async function resolveMailSettings(
  pool: Pool,
  ring: KeyRing,
  environment: Record<string, string | undefined>,
): Promise<ResolvedMailSettings> {
  const rows = await readSettingRows(pool);

  const resolve = <T>(key: string): { value: T; source: SettingSource } => {
    const setting = definition(key);
    const stored = rows.get(key)?.value ?? undefined;
    return resolveSetting<T>(
      stored,
      environmentValue(setting, environment) as T | undefined,
      setting.fallback as T,
    );
  };

  const transport = resolve<string>("mail.transport");

  // The password resolves separately, because its stored form is sealed. The
  // environment value is the bootstrap; a stored secret wins over it, the same
  // order as every plain setting.
  const storedPassword = await readSecret(pool, ring, "mail.password");
  const password =
    storedPassword ??
    (environmentValue(definition("mail.password"), environment) as
      | string
      | undefined) ??
    "";

  return {
    // **Absent falls back. Wrong refuses.** See `readTransport` below.
    transport: readTransport(transport.value),
    host: resolve<string>("mail.host").value,
    port: resolve<number>("mail.port").value,
    secure: resolve<boolean>("mail.secure").value,
    user: resolve<string>("mail.user").value,
    password,
    from: resolve<string>("mail.from").value,
    source: transport.source,
  };
}

/**
 * Thrown when `mail.transport` holds a value this product does not know.
 *
 * A configuration error rather than an operational one: nothing about the
 * instance is broken, somebody typed something it cannot act on.
 */
/** Not exported: nothing catches it by type, and a configuration error
 * should reach whoever started the process rather than be handled. Export it
 * the day something genuinely needs to tell it apart from any other throw. */
class MailTransportError extends Error {
  override readonly name = "MailTransportError";
}

/**
 * Reads the transport, and refuses a value it does not recognise (P7-T08d).
 *
 * **This line used to fall back to `console` for anything unrecognised**,
 * with the reason written beside it: "a typo in a settings row must not take
 * password reset down with it." It was a deliberate trade and its privacy
 * cost was not part of it.
 *
 * A typo does not take password reset down. It moves password reset **into
 * the process log**, along with every address and every live reset link,
 * because the console driver writes each message to stdout. Down is visible
 * and somebody fixes it within the hour. This is invisible and can run for a
 * quarter, losing every invitation and publishing every link.
 *
 * The distinction the old line never drew is between *absent* and *wrong*.
 * Absent means "not configured yet", and console is the right answer: it is
 * what makes a fresh checkout work with no mail server. `smpt` means
 * somebody meant SMTP, and the honest answer is to say which setting is
 * wrong rather than to guess.
 *
 * Found by the P7-T08a privacy review on 11 September 2026; the change was
 * Agung's, because it alters what a misconfigured live instance does.
 */
function readTransport(value: string | undefined): "console" | "smtp" {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    return "console";
  }
  if (trimmed === "console" || trimmed === "smtp") {
    return trimmed;
  }
  throw new MailTransportError(
    `mail.transport is "${trimmed}", which is not a transport this instance ` +
      `has. Use "smtp" to send, or "console" to write messages to the log. ` +
      `Leaving it unset gives you "console". It is refused rather than ` +
      `guessed because falling back would write every message, every ` +
      `address and every password-reset link to the process log without ` +
      `telling anybody.`,
  );
}
