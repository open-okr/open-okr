import {
  mailLocale,
  mailWords,
  renderEmail,
  resolveInstanceDefaultLanguage,
} from "@openokr/core";
import { getInstanceName } from "./instance-name";
import { getPool } from "./pool";

/**
 * The two account mails sent from inside a request, the password reset and
 * the held-sign-in notice, in the shared layout (docs/design/
 * email-templates.md §5). The confirmation mail is built in `packages/core`
 * and sent by the relay (email-verification.md D6).
 *
 * **In the instance's language, not a workspace's.** The person asking may
 * belong to several workspaces or to none yet, so the one language that is
 * always theirs to receive is the deployment's default, `instance.language`.
 *
 * **The link is Better Auth's own**, built from the instance's base url and
 * pointing at its own route, which then sends the person to the page that
 * finishes the job: `/reset-password`. Nothing here invents a url.
 */

export interface AccountMail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

async function mailContext() {
  const [instance, language] = await Promise.all([
    getInstanceName(),
    resolveInstanceDefaultLanguage(getPool()).catch(() => "en"),
  ]);
  const locale = mailLocale(language);
  return { instance, locale, t: mailWords(locale) };
}

export async function resetPasswordMail(
  to: string,
  url: string,
): Promise<AccountMail> {
  const { instance, locale, t } = await mailContext();
  const host = new URL(url).host;
  const { html, text } = renderEmail(
    {
      lang: locale,
      brand: { name: instance },
      preheader: t("reset.preheader"),
      footer: [t("reset.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("reset.eyebrow") },
      { kind: "heading", text: t("reset.heading") },
      {
        kind: "paragraph",
        parts: [t("reset.bodyBefore"), { bold: to }, t("reset.bodyAfter")],
      },
      { kind: "action", label: t("reset.action"), href: url },
      { kind: "notice", parts: [t("reset.notice")] },
    ],
  );
  return { subject: t("reset.subject", { instance }), html, text };
}

/**
 * Somebody is trying this account's password (docs/design/account-lockout.md
 * Q2, approved by Akmal on 9 November 2026). Sent once, when a run of wrong
 * passwords from unfamiliar networks begins an account hold. The button goes
 * to the page that asks for a reset link, because a link in this mail that
 * itself reset the password would be a credential sent to somebody who did
 * not ask for one.
 */
export async function signInHeldMail(
  to: string,
  resetUrl: string,
): Promise<AccountMail> {
  const { instance, locale, t } = await mailContext();
  const host = new URL(resetUrl).host;
  const { html, text } = renderEmail(
    {
      lang: locale,
      brand: { name: instance },
      preheader: t("held.preheader"),
      footer: [t("held.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("held.eyebrow") },
      { kind: "heading", text: t("held.heading") },
      {
        kind: "paragraph",
        parts: [
          t("held.bodyBefore"),
          { bold: to },
          t("held.bodyAfter", { instance }),
        ],
      },
      { kind: "action", label: t("held.action"), href: resetUrl },
      { kind: "notice", parts: [t("held.notice")] },
    ],
  );
  return { subject: t("held.subject", { instance }), html, text };
}
