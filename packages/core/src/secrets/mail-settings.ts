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
    // Anything unrecognised falls back to console: a typo in a settings row
    // must not take password reset down with it.
    transport: transport.value === "smtp" ? "smtp" : "console",
    host: resolve<string>("mail.host").value,
    port: resolve<number>("mail.port").value,
    secure: resolve<boolean>("mail.secure").value,
    user: resolve<string>("mail.user").value,
    password,
    from: resolve<string>("mail.from").value,
    source: transport.source,
  };
}
