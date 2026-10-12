import { renderEmail, resolveInstanceDefaultLanguage } from "@openokr/core";
import { CATALOGUES, type Locale, translate } from "@openokr/ui";
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
  const locale: Locale = language === "ms" ? "ms" : "en";
  const t = (key: string, values?: Record<string, string>) =>
    translate(CATALOGUES[locale], key, values);
  return { instance, locale, t };
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
      preheader: t("mail.reset.preheader"),
      footer: [t("mail.reset.footer", { instance, host })],
      labels: { linkFallback: t("mail.linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("mail.reset.eyebrow") },
      { kind: "heading", text: t("mail.reset.heading") },
      {
        kind: "paragraph",
        parts: [
          t("mail.reset.bodyBefore"),
          { bold: to },
          t("mail.reset.bodyAfter"),
        ],
      },
      { kind: "action", label: t("mail.reset.action"), href: url },
      { kind: "notice", parts: [t("mail.reset.notice")] },
    ],
  );
  return { subject: t("mail.reset.subject", { instance }), html, text };
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
      preheader: t("mail.verify.preheader"),
      footer: [t("mail.verify.footer")],
      labels: { linkFallback: t("mail.linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("mail.verify.eyebrow") },
      { kind: "heading", text: t("mail.verify.heading") },
      {
        kind: "paragraph",
        parts: [
          t("mail.verify.bodyBefore"),
          { bold: to },
          t("mail.verify.bodyAfter", { instance }),
        ],
      },
      { kind: "action", label: t("mail.verify.action"), href: url },
    ],
  );
  return { subject: t("mail.verify.subject", { instance }), html, text };
}
