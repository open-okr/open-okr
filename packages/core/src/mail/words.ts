/**
 * The words the mails use, in each language the product ships
 * (docs/design/email-templates.md §10).
 *
 * **Here rather than in the web catalogue.** Most mails are built in this
 * package, by the outbox and the nudge delivery, and this package may not
 * depend on `packages/ui`. One table for every mail keeps the account mails
 * and the workspace mails in the same words, and `mail-words.test.ts` holds
 * the two languages to the same keys and the same holes.
 *
 * A hole is `{name}`, filled by `mailWords(locale)(key, values)`.
 */

export type MailLocale = "en" | "ms";

const en = {
  linkFallback: "Button not working? Paste this link into your browser:",
  changeWhatYouReceive: "Change what you receive",
  snoozeOrChangeChannel: "Snooze or change channel",

  "reset.subject": "Reset your {instance} password",
  "reset.preheader": "Choose a new password. The link works once.",
  "reset.eyebrow": "Account security",
  "reset.heading": "Reset your password",
  "reset.bodyBefore": "Someone asked to reset the password for ",
  "reset.bodyAfter": ". Choose a new one with the button below.",
  "reset.action": "Choose a new password",
  "reset.notice":
    "Not you? Ignore this email. Your password stays the same, and the link expires.",
  "reset.footer":
    "Sent by {instance} at {host} because a password reset was requested.",

  "verify.subject": "Confirm your email address for {instance}",
  "verify.preheader": "One click and your account is ready.",
  "verify.eyebrow": "Welcome",
  "verify.heading": "Confirm your email address",
  "verify.bodyBefore": "Confirm ",
  "verify.bodyAfter": " to finish setting up your {instance} account.",
  "verify.action": "Confirm email",
  "verify.footer":
    "Did not sign up? Ignore this email and no account is created.",

  "invite.subject": "You have been invited to {workspace}",
  "invite.preheader": "Join to see your team's OKRs.",
  "invite.preheaderBy": "{inviter} added you. Join to see your team's OKRs.",
  "invite.eyebrow": "Invitation",
  "invite.heading": "Join {workspace} on {instance}",
  "invite.headingNoWorkspace": "Join a workspace on {instance}",
  "invite.bodyNoWorkspace":
    "Your team sets and tracks its OKRs here: the goals, the weekly check-ins and the reviews.",
  "invite.body":
    "{workspace} sets and tracks its OKRs here: the goals, the weekly check-ins and the reviews.",
  "invite.invitedBy": " invited you. ",
  "invite.action": "Accept the invitation",
  "invite.notice": "The invitation is for this address only.",
  "invite.noticeExpires":
    "The invitation is for this address only and expires on {date}.",
  "invite.footer":
    "Not expecting this? Ignore it. Nothing happens until you accept.",

  "digest.subjectOne": "{workspace}: 1 update",
  "digest.subjectMany": "{workspace}: {count} updates",
  "digest.headingOne": "1 update",
  "digest.headingMany": "{count} updates",
  "digest.muted": "From the goals and the work you follow.",
  "digest.more": "And {count} more in your inbox.",
  "digest.action": "Open your inbox",
  "digest.open": "Open",
  "digest.footer": "You get this because you follow these. ",
  "digest.reason.mentioned": "Mentioned you",
  "digest.reason.joined": "Update",
  "digest.reason.check_in": "Reminder",
  "digest.reason.review": "To review",
  "digest.reason.invited": "Invitation",
  "digest.reason.role": "Role change",

  "nudge.badge": "AGENT",
  "nudge.coach": "OKR Coach",
  "nudge.coachRole": "Guards the quality of your OKRs",
  "nudge.champion": "OKR Champion",
  "nudge.championRole": "Keeps the rhythm of your OKRs",
  "nudge.footer":
    "Every message names the rule it follows: {rule}. Quiet hours are respected. ",
  "nudge.summaryHeading": "Since you last looked",
  "nudge.summaryHeld": "Held back this week, past your limit",
} as const;

export type MailWordKey = keyof typeof en;

const ms: Readonly<Record<MailWordKey, string>> = {
  linkFallback:
    "Butang tidak berfungsi? Tampal pautan ini ke dalam pelayar anda:",
  changeWhatYouReceive: "Ubah apa yang anda terima",
  snoozeOrChangeChannel: "Tunda atau tukar saluran",

  "reset.subject": "Tetapkan semula kata laluan {instance} anda",
  "reset.preheader":
    "Pilih kata laluan baharu. Pautan ini hanya berfungsi sekali.",
  "reset.eyebrow": "Keselamatan akaun",
  "reset.heading": "Tetapkan semula kata laluan anda",
  "reset.bodyBefore":
    "Seseorang meminta untuk menetapkan semula kata laluan bagi ",
  "reset.bodyAfter": ". Pilih kata laluan baharu dengan butang di bawah.",
  "reset.action": "Pilih kata laluan baharu",
  "reset.notice":
    "Bukan anda? Abaikan e-mel ini. Kata laluan anda kekal sama, dan pautan ini akan tamat tempoh.",
  "reset.footer":
    "Dihantar oleh {instance} di {host} kerana permintaan menetapkan semula kata laluan.",

  "verify.subject": "Sahkan alamat e-mel anda untuk {instance}",
  "verify.preheader": "Satu klik dan akaun anda sedia.",
  "verify.eyebrow": "Selamat datang",
  "verify.heading": "Sahkan alamat e-mel anda",
  "verify.bodyBefore": "Sahkan ",
  "verify.bodyAfter": " untuk melengkapkan akaun {instance} anda.",
  "verify.action": "Sahkan e-mel",
  "verify.footer": "Tidak mendaftar? Abaikan e-mel ini dan tiada akaun dibuat.",

  "invite.subject": "Anda dijemput ke {workspace}",
  "invite.preheader": "Sertai untuk melihat OKR pasukan anda.",
  "invite.preheaderBy":
    "{inviter} menambah anda. Sertai untuk melihat OKR pasukan anda.",
  "invite.eyebrow": "Jemputan",
  "invite.heading": "Sertai {workspace} di {instance}",
  "invite.headingNoWorkspace": "Sertai ruang kerja di {instance}",
  "invite.bodyNoWorkspace":
    "Pasukan anda menetapkan dan menjejak OKRnya di sini: matlamat, daftar masuk mingguan dan semakan.",
  "invite.body":
    "{workspace} menetapkan dan menjejak OKRnya di sini: matlamat, daftar masuk mingguan dan semakan.",
  "invite.invitedBy": " menjemput anda. ",
  "invite.action": "Terima jemputan",
  "invite.notice": "Jemputan ini untuk alamat ini sahaja.",
  "invite.noticeExpires":
    "Jemputan ini untuk alamat ini sahaja dan tamat tempoh pada {date}.",
  "invite.footer":
    "Tidak menjangkakan ini? Abaikan sahaja. Tiada apa berlaku sehingga anda menerimanya.",

  "digest.subjectOne": "{workspace}: 1 kemas kini",
  "digest.subjectMany": "{workspace}: {count} kemas kini",
  "digest.headingOne": "1 kemas kini",
  "digest.headingMany": "{count} kemas kini",
  "digest.muted": "Daripada matlamat dan kerja yang anda ikuti.",
  "digest.more": "Dan {count} lagi dalam peti masuk anda.",
  "digest.action": "Buka peti masuk anda",
  "digest.open": "Buka",
  "digest.footer": "Anda menerima ini kerana anda mengikutinya. ",
  "digest.reason.mentioned": "Menyebut anda",
  "digest.reason.joined": "Kemas kini",
  "digest.reason.check_in": "Peringatan",
  "digest.reason.review": "Untuk disemak",
  "digest.reason.invited": "Jemputan",
  "digest.reason.role": "Perubahan peranan",

  "nudge.badge": "EJEN",
  "nudge.coach": "OKR Coach",
  "nudge.coachRole": "Menjaga kualiti OKR anda",
  "nudge.champion": "OKR Champion",
  "nudge.championRole": "Menjaga rentak OKR anda",
  "nudge.footer":
    "Setiap mesej menamakan peraturan yang diikutinya: {rule}. Waktu senyap dihormati. ",
  "nudge.summaryHeading": "Sejak anda terakhir melihat",
  "nudge.summaryHeld": "Ditahan minggu ini, melebihi had anda",
};

const WORDS: Readonly<
  Record<MailLocale, Readonly<Record<MailWordKey, string>>>
> = { en, ms };

/** The locale a stored language reads as: Malay where it says so, English otherwise. */
export function mailLocale(language: string | null | undefined): MailLocale {
  return language === "ms" ? "ms" : "en";
}

export type MailWords = (
  key: MailWordKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

export function mailWords(locale: MailLocale): MailWords {
  return (key, values) =>
    WORDS[locale][key].replace(/\{(\w+)\}/g, (hole, name: string) =>
      values && name in values ? String(values[name]) : hole,
    );
}

/** Both tables, for the test that holds them to the same keys and holes. */
export const MAIL_WORD_TABLES = WORDS;
