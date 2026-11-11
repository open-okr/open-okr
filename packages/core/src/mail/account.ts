/**
 * The account mails the relay sends: the link that confirms an email address
 * (docs/design/email-verification.md D6, D18; email-templates.md §5), and the
 * notice that a password changed (account-self-service.md D9).
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
  /**
   * Confirmation is off and the account works already (plan 0.8.0 S4), so
   * the words offer the link rather than ask for it.
   */
  readonly optional?: boolean;
}): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  if (input.optional) {
    const optional = renderEmail(
      {
        lang: input.locale,
        brand: { name: instance },
        preheader: t("verifyOptional.preheader"),
        footer: [t("verify.footer")],
        labels: { linkFallback: t("linkFallback") },
      },
      [
        { kind: "eyebrow", text: t("verify.eyebrow") },
        { kind: "heading", text: t("verifyOptional.heading") },
        {
          kind: "paragraph",
          parts: [
            t("verifyOptional.bodyBefore"),
            { bold: input.to },
            t("verifyOptional.bodyAfter"),
          ],
        },
        {
          kind: "action",
          label: t("verifyOptional.action"),
          href: input.url,
        },
        {
          kind: "notice",
          parts: [t("verify.notice", { hours: input.hours })],
        },
      ],
    );
    return {
      subject: t("verifyOptional.subject", { instance }),
      html: optional.html,
      text: optional.text,
    };
  }
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

/**
 * The password of this account changed (docs/design/account-self-service.md
 * §4.2, D9, D13): changed while signed in, set where there was none, or reset
 * through the mailbox.
 *
 * It says when, to the minute in UTC, and whether other devices were signed
 * out. **Never the password, and never a link that changes it**: the one
 * button goes to the page that asks for a reset link, as the held-sign-in
 * notice does, so the mail itself is no credential.
 */
export function passwordChangedMail(input: {
  readonly instanceName: string;
  readonly locale: MailLocale;
  readonly to: string;
  readonly via: "change" | "set" | "reset";
  readonly otherSessionsEnded: boolean;
  readonly at: Date;
  /** The instance's public origin, where `/forgot-password` lives. */
  readonly baseUrl: string;
}): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const resetUrl = new URL("/forgot-password", input.baseUrl).toString();
  const host = new URL(resetUrl).host;
  const date = input.at.toLocaleDateString(
    input.locale === "ms" ? "ms-MY" : "en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
  );
  const time = input.at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  const words = {
    change: {
      subject: t("passwordChanged.subjectChange", { instance }),
      heading: t("passwordChanged.headingChange"),
      body: t("passwordChanged.bodyChange", { date, time }),
    },
    set: {
      subject: t("passwordChanged.subjectSet", { instance }),
      heading: t("passwordChanged.headingSet"),
      body: t("passwordChanged.bodySet", { date, time }),
    },
    reset: {
      subject: t("passwordChanged.subjectReset", { instance }),
      heading: t("passwordChanged.headingReset"),
      body: t("passwordChanged.bodyReset", { date, time }),
    },
  }[input.via];
  // A reset ends every session, the one that asked included; a change with
  // the box ticked ends every other one.
  const sessions = !input.otherSessionsEnded
    ? t("passwordChanged.stayedSignedIn")
    : input.via === "reset"
      ? t("passwordChanged.signedOutEverywhere")
      : t("passwordChanged.signedOutOthers");
  const { html, text } = renderEmail(
    {
      lang: input.locale,
      brand: { name: instance },
      preheader: t("passwordChanged.preheader"),
      footer: [t("passwordChanged.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("passwordChanged.eyebrow") },
      { kind: "heading", text: words.heading },
      {
        kind: "paragraph",
        parts: [
          t("passwordChanged.bodyBefore"),
          { bold: input.to },
          words.body,
        ],
      },
      { kind: "paragraph", parts: [sessions] },
      { kind: "notice", parts: [t("passwordChanged.notYou")] },
      { kind: "action", label: t("passwordChanged.action"), href: resetUrl },
    ],
  );
  return { subject: words.subject, html, text };
}
