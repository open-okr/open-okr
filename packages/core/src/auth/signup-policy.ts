/**
 * Whether a sign-in must wait for a verified address (P8-T02b).
 *
 * **The question is not "is this a cloud", it is "can a link arrive".**
 * `requireEmailVerification` has been false since P1-T05 with a reason
 * written beside it: a self-hosted first run has no mail server, and
 * blocking the first login on an email nobody can receive makes the product
 * unusable out of the box. That reason stops applying the moment the
 * instance has a real transport, and it stops applying whether the instance
 * is a managed cloud or somebody's own server.
 *
 * Agung chose this over tying it to `cloud.enabled` on 14 September 2026. It
 * is the better rule for the same effort: a self-hosted instance with SMTP
 * gets verification too, and nobody has to remember that the cloud flag also
 * means this.
 *
 * **Resolved once, at boot.** Better Auth reads
 * `emailAndPassword.requireEmailVerification` off an options object built
 * once per process, and `getAuth()` is synchronous. So the web app resolves
 * this during `register()` and hands the answer in. Changing `mail.transport`
 * therefore needs a restart before sign-in behaviour follows, which is worth
 * knowing and is the price of not making `getAuth()` async.
 *
 * The safe direction is off. A process that somehow asks before the boot
 * step ran behaves as every instance did before this existed, rather than
 * locking everybody out.
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";

const MAIL_TRANSPORT_KEY = "mail.transport";

/** The transport that writes to the log instead of sending. */
const CONSOLE_TRANSPORT = "console";

/** The transports that genuinely deliver. */
const DELIVERING_TRANSPORTS: readonly string[] = ["smtp"];

export async function resolveRequireEmailVerification(
  pool: Pool,
): Promise<boolean> {
  const definition = getInstanceSetting(MAIL_TRANSPORT_KEY);
  if (!definition) {
    return false;
  }
  const stored = await readSetting(pool, MAIL_TRANSPORT_KEY);
  const environment = environmentValue(definition, process.env);
  const transport = resolveSetting(stored, environment, definition.fallback)
    .value as string;

  // An unrecognised transport is deliberately not treated as delivering.
  // P7-T08d made a typo refuse and name the setting rather than silently
  // become `console`; whatever that refusal does, it must not be reached by
  // locking every member out of sign-in first.
  if (transport === CONSOLE_TRANSPORT) {
    return false;
  }
  return DELIVERING_TRANSPORTS.includes(transport);
}
