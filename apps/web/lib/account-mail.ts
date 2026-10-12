import {
  mailLocale,
  mailWords,
  renderEmail,
  resolveInstanceDefaultLanguage,
} from "@openokr/core";
import { getInstanceName } from "./instance-name";
import { getPool } from "./pool";

/**
 * The two account mails, password reset and email confirmation, in the
 * shared layout (docs/design/email-templates.md §5).
 *
 * **In the instance's language, not a workspace's.** The person asking may
 * belong to several workspaces or to none yet, so the one language that is
 * always theirs to receive is the deployment's default, `instance.language`.
 *
 * **The link is Better Auth's own**, built from the instance's base url and
 * pointing at its own verification route, which then sends the person to the
 * page that finishes the job: `/reset-password` for a reset, the home screen
 * for a confirmation. Nothing here invents a url.
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

export async function verifyEmailMail(
  to: string,
  url: string,
): Promise<AccountMail> {
  const { instance, locale, t } = await mailContext();
  const { html, text } = renderEmail(
    {
      lang: locale,
      brand: { name: instance },
      preheader: t("verify.preheader"),
      footer: [t("verify.footer")],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("verify.eyebrow") },
      { kind: "heading", text: t("verify.heading") },
      {
        kind: "paragraph",
        parts: [
          t("verify.bodyBefore"),
          { bold: to },
          t("verify.bodyAfter", { instance }),
        ],
      },
      { kind: "action", label: t("verify.action"), href: url },
    ],
  );
  return { subject: t("verify.subject", { instance }), html, text };
}
