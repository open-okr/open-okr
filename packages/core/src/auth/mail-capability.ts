/**
 * Whether this instance can send mail at all (docs/design/
 * account-self-service.md D14, plan 0.8.0 Y4).
 *
 * **A question of its own, not the confirmation rule.** Changing a sign-in
 * email needs the new address's link to arrive, whatever an administrator
 * decided about confirming addresses at sign-up. The confirmation rule reads
 * the transport today and may read more than it later (plan 0.8.0 S4), so
 * the two are asked separately and only the transport answers this one.
 *
 * **Resolved once, at boot**, like the confirmation rule. Better Auth reads
 * `user.changeEmail.enabled` off an options object built once per process,
 * and Your account reads the same stored answer, so the page and the
 * endpoint can never disagree. Changing `mail.transport` needs a restart
 * before either follows.
 *
 * Only `smtp` delivers. `console` writes to the log, and a value the product
 * does not know is not treated as delivering: an unknown transport refuses
 * to send rather than guessing (P7-T08d).
 */
import type { Pool } from "pg";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import { readSetting, resolveSetting } from "../secrets/instance-settings.ts";

const MAIL_TRANSPORT_KEY = "mail.transport";

/** The transports that genuinely deliver. */
const DELIVERING_TRANSPORTS: readonly string[] = ["smtp"];

export async function resolveCanSendMail(pool: Pool): Promise<boolean> {
  const definition = getInstanceSetting(MAIL_TRANSPORT_KEY);
  if (!definition) {
    return false;
  }
  const stored = await readSetting(pool, MAIL_TRANSPORT_KEY);
  const environment = environmentValue(definition, process.env);
  const transport = resolveSetting(stored, environment, definition.fallback)
    .value as string;
  return DELIVERING_TRANSPORTS.includes(transport);
}
