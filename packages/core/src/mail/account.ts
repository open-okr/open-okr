/**
 * The account mail builders for password resets, email verification,
 * password change notices, and sign-in email changes
 * (email-templates.md §5 and account-self-service.md §4.2).
 *
 * The reset and held-sign-in notices use the visitor's request language
 * when available. Account mail sent by the relay uses the instance language
 * (languages §13, A-8).
 *
 * **The link is Better Auth's own**, as it was handed to the callback. Nothing
 * here invents a url.
 */
import { intlTagFor, isShippedLocale } from "@openokr/formats";
import type { BuiltMail } from "./mails.ts";
import { renderEmail } from "./render.ts";
import { type MailLocale, mailLocale, mailWords } from "./words.ts";

export function accountMailLocale(
  instanceLanguage: string,
  requestLocale?: string,
): MailLocale {
  return mailLocale(
    isShippedLocale(requestLocale) ? requestLocale : instanceLanguage,
  );
}

/** The link Better Auth sends when a visitor asks to reset a password. */
export function resetPasswordMail(input: {
  readonly instanceName: string;
  readonly instanceLanguage: string;
  readonly requestLocale?: string;
  readonly to: string;
  readonly url: string;
}): BuiltMail {
  const { instanceName: instance, to, url } = input;
  const locale = accountMailLocale(input.instanceLanguage, input.requestLocale);
  const t = mailWords(locale);
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
 * It says when, to the minute in the person's own timezone, and whether other devices were signed
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
  /** The person's timezone, from `timezoneForAccount`; UTC when absent. */
  readonly timeZone?: string;
  /** The instance's public origin, where `/forgot-password` lives. */
  readonly baseUrl: string;
}): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const resetUrl = new URL("/forgot-password", input.baseUrl).toString();
  const host = new URL(resetUrl).host;
  const { date, time, zone } = dateAndTime(
    input.at,
    input.locale,
    input.timeZone,
  );
  const words = {
    change: {
      subject: t("passwordChanged.subjectChange", { instance }),
      heading: t("passwordChanged.headingChange"),
      body: t("passwordChanged.bodyChange", { date, time, zone }),
    },
    set: {
      subject: t("passwordChanged.subjectSet", { instance }),
      heading: t("passwordChanged.headingSet"),
      body: t("passwordChanged.bodySet", { date, time, zone }),
    },
    reset: {
      subject: t("passwordChanged.subjectReset", { instance }),
      heading: t("passwordChanged.headingReset"),
      body: t("passwordChanged.bodyReset", { date, time, zone }),
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

/**
 * "11 November 2026", "15:05" and the zone they are in, as the password and
 * email-change notices say them. In the person's own timezone, named, so
 * somebody checking whether it was them does no sum (UAT 0.8.0 Q-7); UTC
 * when there is none or the runtime does not know it.
 */
function dateAndTime(
  at: Date,
  locale: MailLocale,
  timeZone = "UTC",
): { readonly date: string; readonly time: string; readonly zone: string } {
  let zone = timeZone;
  try {
    // machine use: validating timezone
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  return {
    date: at.toLocaleDateString(intlTagFor(locale), {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: zone,
    }),
    time: at.toLocaleTimeString(intlTagFor(locale), {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    }),
    zone,
  };
}

/**
 * The link that makes a new address the sign-in email (docs/design/
 * account-self-service.md §4.2, D18, plan 0.8.0 Y4), to that new address.
 *
 * It says what opening it does and for how long it works, and that it works
 * where the person is signed in (D19). Not opening it changes nothing.
 */
export function changeEmailMail(input: {
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
      preheader: t("changeEmail.preheader"),
      footer: [t("changeEmail.footer")],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("changeEmail.eyebrow") },
      { kind: "heading", text: t("changeEmail.heading") },
      {
        kind: "paragraph",
        parts: [
          t("changeEmail.bodyBefore"),
          { bold: input.to },
          t("changeEmail.bodyAfter", { instance }),
        ],
      },
      { kind: "action", label: t("changeEmail.action"), href: input.url },
      {
        kind: "notice",
        parts: [t("changeEmail.notice", { hours: input.hours, instance })],
      },
    ],
  );
  return { subject: t("changeEmail.subject", { instance }), html, text };
}

/**
 * The notice to the current address that a new sign-in email was asked for
 * (account-self-service.md §4.2, D16, AS-Q4 (a)). **The same words whether
 * or not the new address has an account**, so the notice says nothing about
 * anybody else. The one button goes to Security, where changing the password
 * with "Sign out my other devices" stops an unopened link (D19).
 */
export function emailChangeNoticeMail(input: {
  readonly instanceName: string;
  readonly locale: MailLocale;
  readonly to: string;
  readonly newEmail: string;
  readonly at: Date;
  /** The person's timezone, from `timezoneForAccount`; UTC when absent. */
  readonly timeZone?: string;
  /** The instance's public origin, where `/account/security` lives. */
  readonly baseUrl: string;
}): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const securityUrl = new URL("/account/security", input.baseUrl).toString();
  const host = new URL(securityUrl).host;
  const { date, time, zone } = dateAndTime(
    input.at,
    input.locale,
    input.timeZone,
  );
  const { html, text } = renderEmail(
    {
      lang: input.locale,
      brand: { name: instance },
      preheader: t("emailChangeNotice.preheader"),
      footer: [t("emailChangeNotice.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("emailChangeNotice.eyebrow") },
      { kind: "heading", text: t("emailChangeNotice.heading") },
      {
        kind: "paragraph",
        parts: [
          t("emailChangeNotice.bodyBefore"),
          { bold: input.newEmail },
          t("emailChangeNotice.bodyAfter", { date, time, zone }),
        ],
      },
      {
        kind: "paragraph",
        parts: [t("emailChangeNotice.ifYou", { to: input.newEmail })],
      },
      { kind: "notice", parts: [t("emailChangeNotice.notYou")] },
      {
        kind: "action",
        label: t("emailChangeNotice.action"),
        href: securityUrl,
      },
    ],
  );
  return {
    subject: t("emailChangeNotice.subject", { instance }),
    html,
    text,
  };
}

/**
 * What an address that already has an account hears when somebody asks to
 * make it another account's sign-in email (account-self-service.md AS-Q5
 * (b)): nothing changed. Nobody waits for a link that never comes, and only
 * whoever holds the mailbox learns anything, which Forgot password would
 * tell them anyway.
 */
export function emailChangeTakenMail(input: {
  readonly instanceName: string;
  readonly locale: MailLocale;
  /** The instance's public origin, where `/forgot-password` lives. */
  readonly baseUrl: string;
}): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const resetUrl = new URL("/forgot-password", input.baseUrl).toString();
  const host = new URL(resetUrl).host;
  const { html, text } = renderEmail(
    {
      lang: input.locale,
      brand: { name: instance },
      preheader: t("emailChangeTaken.preheader"),
      footer: [t("emailChangeTaken.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("emailChangeTaken.eyebrow") },
      { kind: "heading", text: t("emailChangeTaken.heading") },
      {
        kind: "paragraph",
        parts: [t("emailChangeTaken.body", { instance })],
      },
      { kind: "paragraph", parts: [t("emailChangeTaken.forgot")] },
      { kind: "action", label: t("emailChangeTaken.action"), href: resetUrl },
    ],
  );
  return {
    subject: t("emailChangeTaken.subject", { instance }),
    html,
    text,
  };
}

/** "11 November 2026", in UTC, as the deletion mails say a day. */
function dayOf(at: Date, locale: MailLocale): string {
  return dateAndTime(at, locale).date;
}

/** What every deletion mail needs to be built. */
interface DeletionMailInput {
  readonly instanceName: string;
  readonly locale: MailLocale;
  readonly to: string;
  /** The instance's public origin, where `/sign-in` and `/account` live. */
  readonly baseUrl: string;
}

/**
 * A deletion was asked for (docs/design/account-deletion.md §3.1, plan 0.8.0
 * Y7): when it runs, that every device was signed out, and that signing in
 * before then keeps the account. The button goes to sign-in, which is itself
 * the cancellation, so the mail carries no credential.
 */
export function deletionRequestedMail(
  input: DeletionMailInput & { readonly runsAt: Date },
): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const signInUrl = new URL("/sign-in", input.baseUrl).toString();
  const host = new URL(signInUrl).host;
  const date = dayOf(input.runsAt, input.locale);
  const { html, text } = renderEmail(
    {
      lang: input.locale,
      brand: { name: instance },
      preheader: t("deletion.requestedPreheader"),
      footer: [t("deletion.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("deletion.eyebrow") },
      { kind: "heading", text: t("deletion.requestedHeading") },
      {
        kind: "paragraph",
        parts: [
          t("deletion.requestedBefore"),
          { bold: input.to },
          t("deletion.requestedAfter", { date }),
        ],
      },
      { kind: "paragraph", parts: [t("deletion.requestedKeep")] },
      { kind: "notice", parts: [t("deletion.requestedNotYou")] },
      { kind: "action", label: t("deletion.signIn"), href: signInUrl },
    ],
  );
  return {
    subject: t("deletion.requestedSubject", { instance, date }),
    html,
    text,
  };
}

/** The day before the deletion runs (design §3.2, Y7-1). */
export function deletionTomorrowMail(
  input: DeletionMailInput & { readonly runsAt: Date },
): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const signInUrl = new URL("/sign-in", input.baseUrl).toString();
  const host = new URL(signInUrl).host;
  const date = dayOf(input.runsAt, input.locale);
  const { html, text } = renderEmail(
    {
      lang: input.locale,
      brand: { name: instance },
      preheader: t("deletion.tomorrowPreheader"),
      footer: [t("deletion.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("deletion.eyebrow") },
      { kind: "heading", text: t("deletion.tomorrowHeading") },
      {
        kind: "paragraph",
        parts: [
          t("deletion.tomorrowBefore"),
          { bold: input.to },
          t("deletion.tomorrowAfter", { date }),
        ],
      },
      { kind: "paragraph", parts: [t("deletion.tomorrowKeep")] },
      { kind: "action", label: t("deletion.signIn"), href: signInUrl },
    ],
  );
  return { subject: t("deletion.tomorrowSubject", { instance }), html, text };
}

/** Why a deletion was cancelled, as the cancelled mail says it. */
export type DeletionCancelReason =
  | { readonly kind: "signed_in" }
  | { readonly kind: "last_owner"; readonly workspace: string }
  | { readonly kind: "directory" }
  | { readonly kind: "other" };

/**
 * The deletion was cancelled (design §3.2, §3.3): because the person signed
 * in, or because a refusal held when the run began, naming what to do
 * (Y7-Q1).
 */
export function deletionCancelledMail(
  input: DeletionMailInput & { readonly reason: DeletionCancelReason },
): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const accountUrl = new URL("/account", input.baseUrl).toString();
  const host = new URL(accountUrl).host;
  const sentence =
    input.reason.kind === "signed_in"
      ? t("deletion.cancelledSignedIn")
      : input.reason.kind === "last_owner"
        ? t("deletion.cancelledLastOwner", {
            workspace: input.reason.workspace,
          })
        : input.reason.kind === "directory"
          ? t("deletion.cancelledDirectory")
          : t("deletion.cancelledOther");
  const { html, text } = renderEmail(
    {
      lang: input.locale,
      brand: { name: instance },
      preheader: t("deletion.cancelledPreheader"),
      footer: [t("deletion.footer", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("deletion.eyebrow") },
      { kind: "heading", text: t("deletion.cancelledHeading") },
      { kind: "paragraph", parts: [sentence] },
      ...(input.reason.kind === "signed_in"
        ? [
            {
              kind: "notice" as const,
              parts: [t("deletion.cancelledNotYou")],
            },
          ]
        : []),
      { kind: "action", label: t("deletion.openAccount"), href: accountUrl },
    ],
  );
  return { subject: t("deletion.cancelledSubject", { instance }), html, text };
}

/**
 * The deletion is done (design §3.3). The last mail to the address: it was
 * read before the account was anonymised and leaves the outbox row once
 * delivered.
 */
export function deletionDoneMail(input: DeletionMailInput): BuiltMail {
  const t = mailWords(input.locale);
  const instance = input.instanceName;
  const host = new URL(input.baseUrl).host;
  const { html, text } = renderEmail(
    {
      lang: input.locale,
      brand: { name: instance },
      preheader: t("deletion.donePreheader"),
      footer: [t("deletion.doneFooter", { instance, host })],
      labels: { linkFallback: t("linkFallback") },
    },
    [
      { kind: "eyebrow", text: t("deletion.eyebrow") },
      { kind: "heading", text: t("deletion.doneHeading") },
      {
        kind: "paragraph",
        parts: [
          t("deletion.doneBefore"),
          { bold: input.to },
          t("deletion.doneAfter"),
        ],
      },
    ],
  );
  return { subject: t("deletion.doneSubject", { instance }), html, text };
}
