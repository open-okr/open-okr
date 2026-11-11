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
  // The link's lifetime, and a footer that is true: the account exists
  // already, unconfirmed (email-verification.md D18).
  "verify.notice": "The link works for {hours} hours.",
  "verify.footer":
    "Did not sign up? Ignore this email. Nothing is confirmed unless the link is opened.",

  // A password was changed, set or reset (account-self-service.md D9, D13).
  // Never the password, and never a link that changes it.
  "passwordChanged.subjectChange": "Your {instance} password was changed",
  "passwordChanged.subjectSet": "A password was set on your {instance} account",
  "passwordChanged.subjectReset": "Your {instance} password was reset",
  "passwordChanged.preheader": "If this was not you, reset your password now.",
  "passwordChanged.eyebrow": "Account security",
  "passwordChanged.headingChange": "Your password was changed",
  "passwordChanged.headingSet": "A password was set",
  "passwordChanged.headingReset": "Your password was reset",
  "passwordChanged.bodyBefore": "The password for ",
  "passwordChanged.bodyChange": " was changed on {date} at {time} UTC.",
  "passwordChanged.bodySet": " was set on {date} at {time} UTC.",
  "passwordChanged.bodyReset": " was reset on {date} at {time} UTC.",
  "passwordChanged.signedOutOthers":
    "Your other devices were signed out. API tokens and connected apps keep working.",
  "passwordChanged.signedOutEverywhere":
    "Every device was signed out. API tokens and connected apps keep working.",
  "passwordChanged.stayedSignedIn": "Your other devices stay signed in.",
  "passwordChanged.notYou": "If this was not you, reset your password now.",
  "passwordChanged.action": "Reset your password",
  "passwordChanged.footer":
    "Sent by {instance} at {host} whenever the password of this account changes. It never contains a password.",

  // With confirmation off (plan 0.8.0 S4, email-verification.md §11.3): the
  // account works already, so nothing here may read as a demand.
  "verifyOptional.subject": "Your account on {instance} is ready",
  "verifyOptional.preheader": "You can use your account now.",
  "verifyOptional.heading": "Your account is ready",
  "verifyOptional.bodyBefore":
    "You can use your account now. If you would like to, confirm ",
  "verifyOptional.bodyAfter":
    " with the link below. It lets you join workspaces that admit people by their company's email domain.",
  "verifyOptional.action": "Confirm this address",

  // A run of wrong passwords began an account hold (account-lockout.md Q2).
  "held.subject": "Somebody is trying to sign in to your {instance} account",
  "held.preheader":
    "Password sign-in is paused for networks you have not used lately.",
  "held.eyebrow": "Account security",
  "held.heading": "Somebody is trying your password",
  "held.bodyBefore": "Many wrong passwords have been tried for ",
  "held.bodyAfter":
    " from networks you have not signed in from lately, so {instance} is pausing password sign-in from them a few minutes at a time. Where you usually sign in is not affected.",
  "held.action": "Choose a new password",
  "held.notice":
    "If this was you, wait a few minutes or choose a new password. If it was not, a new password and a second sign-in factor keep the account yours.",
  "held.footer":
    "Sent by {instance} at {host} because many wrong passwords were tried for this account. Sent once for each run of attempts.",

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

  "closed.subject": "{workspace} has been closed",
  "closed.preheader": "It will be deleted on {date}. Export it before then.",
  "closed.preheaderKept": "Export anything you want to keep.",
  "closed.eyebrow": "Workspace closed",
  "closed.heading": "{workspace} is closed",
  "closed.by": " closed it on {date}.",
  "closed.byProvider": "The provider closed it on {date}.",
  "closed.deletedOn":
    "Everything in it stays readable until {date}. Then it is deleted for good, and cannot be brought back.",
  "closed.kept":
    "Everything in it stays readable, and nothing is deleted until the provider decides to.",
  "closed.action": "Export the workspace",
  "closed.mayReopen":
    "Closed by mistake? An owner can reopen it from Admin, General until it is deleted.",
  "closed.providerReopens": "Only the provider can reopen it.",
  "closed.footer": "Sent to the owners and administrators of {workspace}.",

  "reminder.subject": "{workspace} will be deleted on {date}",
  "reminder.preheader": "Seven days left to export it.",
  "reminder.eyebrow": "Deleted in seven days",
  "reminder.heading": "{workspace} will be deleted on {date}",
  "reminder.body":
    "It was closed on {closed}. On {date} everything in it is deleted for good, and cannot be brought back.",

  // A trial ending, and what its end did (tenant-lifecycle.md §11 Q2).
  "trial.subject": "{workspace}: your trial of {plan} ends on {date}",
  "trial.preheader": "Choose a plan before then to keep what you have.",
  "trial.eyebrow": "Trial ends in seven days",
  "trial.heading": "The trial of {plan} ends on {date}",
  "trial.body":
    "If nobody chooses a plan by then, {workspace} moves to {fallback}. If its people do not fit {fallback}, it becomes read-only until somebody chooses a plan or removes people. Nothing is deleted and nobody is removed.",
  "trial.action": "Choose a plan",
  "trial.endedSubject": "{workspace}: the trial has ended",
  "trial.endedPreheader": "Here is what happened to the workspace.",
  "trial.endedEyebrow": "Trial ended",
  "trial.endedHeading": "The trial of {workspace} has ended",
  "trial.endedMoved":
    "It moved to {fallback}. Everything is as it was; the plan's limits now apply.",
  "trial.endedSuspended":
    "Its people do not fit {fallback}, so it is read-only until somebody chooses a plan, or removes people and presses Settle. Nobody was removed and nothing was deleted.",
  "trial.endedSubscribed": "It carries on under its subscription.",
  "trial.noPlan": "no plan, with no seat limit",

  // A webhook turned itself off after a run of failures (outbound-webhooks.md W9).
  "webhookOff.subject": "{workspace}: the webhook {name} was turned off",
  "webhookOff.preheader": "Its last {count} deliveries all failed.",
  "webhookOff.eyebrow": "Webhook turned off",
  "webhookOff.heading": "The webhook {name} was turned off",
  "webhookOff.body":
    "Its last {count} deliveries to {host} all failed, so nothing more is sent to it. Check the receiver, then turn the webhook back on. Each failed delivery is on its page with the reason.",
  "webhookOff.action": "Open the webhooks",
  "webhookOff.footer":
    "Sent to whoever made this webhook in {workspace}. Sent once each time it turns off.",

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
  "digest.reason.support_request": "Support request",
  "digest.reason.support_ended": "Support ended",
  "digest.reason.connection_ended": "Connection ended",

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
  "verify.notice": "Pautan ini berfungsi selama {hours} jam.",
  "verify.footer":
    "Tidak mendaftar? Abaikan e-mel ini. Tiada apa yang disahkan melainkan pautan ini dibuka.",

  "passwordChanged.subjectChange": "Kata laluan {instance} anda telah ditukar",
  "passwordChanged.subjectSet":
    "Kata laluan telah ditetapkan pada akaun {instance} anda",
  "passwordChanged.subjectReset":
    "Kata laluan {instance} anda telah ditetapkan semula",
  "passwordChanged.preheader":
    "Jika ini bukan anda, tetapkan semula kata laluan anda sekarang.",
  "passwordChanged.eyebrow": "Keselamatan akaun",
  "passwordChanged.headingChange": "Kata laluan anda telah ditukar",
  "passwordChanged.headingSet": "Kata laluan telah ditetapkan",
  "passwordChanged.headingReset": "Kata laluan anda telah ditetapkan semula",
  "passwordChanged.bodyBefore": "Kata laluan bagi ",
  "passwordChanged.bodyChange": " telah ditukar pada {date} jam {time} UTC.",
  "passwordChanged.bodySet": " telah ditetapkan pada {date} jam {time} UTC.",
  "passwordChanged.bodyReset":
    " telah ditetapkan semula pada {date} jam {time} UTC.",
  "passwordChanged.signedOutOthers":
    "Peranti anda yang lain telah dilog keluar. Token API dan aplikasi yang disambungkan terus berfungsi.",
  "passwordChanged.signedOutEverywhere":
    "Semua peranti telah dilog keluar. Token API dan aplikasi yang disambungkan terus berfungsi.",
  "passwordChanged.stayedSignedIn": "Peranti anda yang lain kekal log masuk.",
  "passwordChanged.notYou":
    "Jika ini bukan anda, tetapkan semula kata laluan anda sekarang.",
  "passwordChanged.action": "Tetapkan semula kata laluan",
  "passwordChanged.footer":
    "Dihantar oleh {instance} di {host} setiap kali kata laluan akaun ini berubah. Ia tidak pernah mengandungi kata laluan.",

  "verifyOptional.subject": "Akaun anda di {instance} sudah sedia",
  "verifyOptional.preheader": "Anda boleh menggunakan akaun anda sekarang.",
  "verifyOptional.heading": "Akaun anda sudah sedia",
  "verifyOptional.bodyBefore":
    "Anda boleh menggunakan akaun anda sekarang. Jika anda mahu, sahkan ",
  "verifyOptional.bodyAfter":
    " dengan pautan di bawah. Ia membolehkan anda menyertai ruang kerja yang menerima orang melalui domain e-mel syarikat mereka.",
  "verifyOptional.action": "Sahkan alamat ini",

  "held.subject": "Seseorang cuba log masuk ke akaun {instance} anda",
  "held.preheader":
    "Log masuk dengan kata laluan dijeda bagi rangkaian yang jarang anda gunakan.",
  "held.eyebrow": "Keselamatan akaun",
  "held.heading": "Seseorang sedang mencuba kata laluan anda",
  "held.bodyBefore": "Banyak kata laluan salah telah dicuba untuk ",
  "held.bodyAfter":
    " dari rangkaian yang tidak anda gunakan kebelakangan ini, jadi {instance} menjeda log masuk dengan kata laluan dari rangkaian itu beberapa minit pada satu masa. Tempat anda biasa log masuk tidak terjejas.",
  "held.action": "Pilih kata laluan baharu",
  "held.notice":
    "Jika ini anda, tunggu beberapa minit atau pilih kata laluan baharu. Jika bukan, kata laluan baharu dan faktor log masuk kedua memastikan akaun ini kekal milik anda.",
  "held.footer":
    "Dihantar oleh {instance} di {host} kerana banyak kata laluan salah telah dicuba untuk akaun ini. Dihantar sekali bagi setiap siri percubaan.",

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

  "closed.subject": "{workspace} telah ditutup",
  "closed.preheader": "Ia akan dipadam pada {date}. Eksport sebelum itu.",
  "closed.preheaderKept": "Eksport apa-apa yang anda mahu simpan.",
  "closed.eyebrow": "Ruang kerja ditutup",
  "closed.heading": "{workspace} telah ditutup",
  "closed.by": " menutupnya pada {date}.",
  "closed.byProvider": "Penyedia menutupnya pada {date}.",
  "closed.deletedOn":
    "Semua kandungannya kekal boleh dibaca sehingga {date}. Selepas itu ia dipadam terus dan tidak boleh dikembalikan.",
  "closed.kept":
    "Semua kandungannya kekal boleh dibaca, dan tiada apa-apa dipadam sehingga penyedia memutuskannya.",
  "closed.action": "Eksport ruang kerja",
  "closed.mayReopen":
    "Ditutup secara tidak sengaja? Pemilik boleh membukanya semula dari Pentadbiran, Umum sebelum ia dipadam.",
  "closed.providerReopens": "Hanya penyedia boleh membukanya semula.",
  "closed.footer": "Dihantar kepada pemilik dan pentadbir {workspace}.",

  "reminder.subject": "{workspace} akan dipadam pada {date}",
  "reminder.preheader": "Tinggal tujuh hari untuk mengeksportnya.",
  "reminder.eyebrow": "Dipadam dalam tujuh hari",
  "reminder.heading": "{workspace} akan dipadam pada {date}",
  "reminder.body":
    "Ia ditutup pada {closed}. Pada {date} semua kandungannya dipadam terus, dan tidak boleh dikembalikan.",

  "trial.subject": "{workspace}: percubaan {plan} anda tamat pada {date}",
  "trial.preheader":
    "Pilih pelan sebelum itu untuk mengekalkan apa yang anda ada.",
  "trial.eyebrow": "Percubaan tamat dalam tujuh hari",
  "trial.heading": "Percubaan {plan} tamat pada {date}",
  "trial.body":
    "Jika tiada sesiapa memilih pelan menjelang itu, {workspace} beralih ke {fallback}. Jika orangnya tidak muat dalam {fallback}, ia menjadi baca sahaja sehingga seseorang memilih pelan atau mengeluarkan orang. Tiada apa yang dipadam dan tiada sesiapa dikeluarkan.",
  "trial.action": "Pilih pelan",
  "trial.endedSubject": "{workspace}: percubaan telah tamat",
  "trial.endedPreheader": "Inilah yang berlaku kepada ruang kerja.",
  "trial.endedEyebrow": "Percubaan tamat",
  "trial.endedHeading": "Percubaan {workspace} telah tamat",
  "trial.endedMoved":
    "Ia beralih ke {fallback}. Semuanya kekal seperti biasa; had pelan itu kini terpakai.",
  "trial.endedSuspended":
    "Orangnya tidak muat dalam {fallback}, jadi ia baca sahaja sehingga seseorang memilih pelan, atau mengeluarkan orang dan menekan Selesaikan. Tiada sesiapa dikeluarkan dan tiada apa yang dipadam.",
  "trial.endedSubscribed": "Ia diteruskan di bawah langganannya.",
  "trial.noPlan": "tiada pelan, tanpa had tempat duduk",

  "webhookOff.subject": "{workspace}: webhook {name} telah dimatikan",
  "webhookOff.preheader": "{count} penghantaran terakhirnya semua gagal.",
  "webhookOff.eyebrow": "Webhook dimatikan",
  "webhookOff.heading": "Webhook {name} telah dimatikan",
  "webhookOff.body":
    "{count} penghantaran terakhirnya ke {host} semua gagal, jadi tiada apa lagi dihantar kepadanya. Semak penerima, kemudian hidupkan semula webhook itu. Setiap penghantaran yang gagal ada di halamannya bersama sebabnya.",
  "webhookOff.action": "Buka webhook",
  "webhookOff.footer":
    "Dihantar kepada pembuat webhook ini dalam {workspace}. Dihantar sekali setiap kali ia dimatikan.",

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
  "digest.reason.support_request": "Permintaan sokongan",
  "digest.reason.support_ended": "Sokongan tamat",
  "digest.reason.connection_ended": "Sambungan ditamatkan",

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
