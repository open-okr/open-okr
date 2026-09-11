import { getTranslations } from "../../../lib/translations";

/**
 * Tells an operator their instance is still writing every message to the log
 * (P7-T08d).
 *
 * **The console mail driver is the right default and the wrong long-term
 * state.** `mail.transport` defaults to `console`, which is what lets a
 * fresh checkout run the first-run wizard and click an invitation link with
 * no mail server anywhere. That driver writes each message to stdout: the
 * recipient's address, the subject and the body. So an instance still on it
 * a month later is logging every invitation, every digest and every
 * password reset, with the address of the person it was for, into logs that
 * are usually shipped somewhere.
 *
 * The P7-T08a privacy review found nothing anywhere that says so. The driver
 * is doing its job; the gap was that an operator could run like this for a
 * quarter and never be told.
 *
 * **It appears on this screen because there is no mail screen.** Mail is
 * configured by setting and by environment and has no surface of its own,
 * which is its own small finding. This is the instance settings screen, so
 * this is where an instance-level warning belongs until one exists.
 *
 * **The setting names are in the sentence rather than in markup.** An
 * earlier version set `mail.transport` and `smtp` in `<code>` around the
 * words, which put four fragments of an English sentence in the file
 * instead of one string and broke the catalogue gate. A translator needs the
 * whole sentence to move the names within it, so the names live inside the
 * translated text.
 */
export async function ConsoleMailNotice() {
  const { t } = await getTranslations();

  return (
    <section className="rounded-md border border-warn/30 bg-warn/5 p-4.5">
      <h2 className="text-sm font-bold text-warn">
        {t("admin.general.consoleMail.title")}
      </h2>
      <p className="mt-1.5 text-sm text-ink-2">
        {t("admin.general.consoleMail.what")}
      </p>
      <p className="mt-1.5 text-sm text-ink-2">
        {t("admin.general.consoleMail.fix")}
      </p>
    </section>
  );
}
