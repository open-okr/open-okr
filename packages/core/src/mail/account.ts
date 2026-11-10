/**
 * The account mail the relay sends: the link that confirms an email address
 * (docs/design/email-verification.md D6, D18; email-templates.md §5).
 *
 * **Built here, not in the web app,** because the relay's handlers live in
 * this package and may not import `apps/web`. The reset and the held-sign-in
 * mails are still sent from inside the request and are built there
 * (`apps/web/lib/account-mail.ts`).
 *
 * **In the instance's language, not a workspace's.** The person may belong to
 * no workspace yet, so the one language that is always theirs to receive is
 * the deployment's default. The caller resolves it; a builder that only builds
 * is one a test can call.
 *
 * **The link is Better Auth's own**, as it was handed to the callback. Nothing
 * here invents a url.
 */
import type { BuiltMail } from "./mails.ts";
import { renderEmail } from "./render.ts";
import { type MailLocale, mailWords } from "./words.ts";

export function verifyEmailMail(input: {
  readonly instanceName: string;
  readonly locale: MailLocale;
  readonly to: string;
  readonly url: string;
  /** How long the link works, read from `EMAIL_VERIFICATION_LINK_SECONDS`. */
  readonly hours: number;
}): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const { html, text } = renderEmail(
    {
      lang: input.locale,
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
          { bold: input.to },
          t("verify.bodyAfter", { instance }),
        ],
      },
      { kind: "action", label: t("verify.action"), href: input.url },
      {
        kind: "notice",
        parts: [t("verify.notice", { hours: input.hours })],
      },
    ],
  );
  return { subject: t("verify.subject", { instance }), html, text };
}
