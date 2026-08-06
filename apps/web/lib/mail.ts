import { createMailer, type Mailer } from "@openokr/adapters";
import { type ResolvedMailSettings, resolveMailSettings } from "@openokr/core";
import { getPool } from "./auth";
import { getKeyRing } from "./secrets";

/**
 * The application's mailer (P1-T09).
 *
 * Built per use rather than cached, because the configuration lives in the
 * database and an admin can change it while the process runs. A cached mailer
 * would keep sending through the old server until the next deploy, which is
 * exactly the staleness the settings table exists to avoid. Mail volume today
 * is password resets, so construction cost is irrelevant.
 */
export async function getMailSettings(): Promise<ResolvedMailSettings> {
  return resolveMailSettings(getPool(), getKeyRing(), process.env);
}

export function mailerFrom(settings: ResolvedMailSettings): Mailer {
  if (settings.transport === "console") {
    return createMailer({ transport: "console" });
  }
  return createMailer({
    transport: "smtp",
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    from: settings.from,
    ...(settings.user ? { user: settings.user } : {}),
    ...(settings.password ? { password: settings.password } : {}),
  });
}

/** Sends one message through whatever mail is configured right now. */
export async function sendMail(message: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const settings = await getMailSettings();
  // openokr:allow-side-effect: password reset is the only caller, and it has
  // no domain transaction to attach an outbox row to. Better Auth asks for the
  // mail while the person waits on the form, and a reset that is queued rather
  // than sent reads as a broken button. Everything with a transaction behind
  // it goes through the outbox: invitations at P2-T04, notifications at
  // P2-T06. This marker is the reason those must not copy this line.
  await mailerFrom(settings).send(message);
}
